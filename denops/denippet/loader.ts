import { Denops, op } from "./deps/denops.ts";
import { path, TOML, YAML } from "./deps/std.ts";
import { is, u } from "./deps/unknownutil.ts";
import { asyncFilter } from "./util.ts";

const isStringOrArray = is.UnionOf([is.String, is.ArrayOf(is.String)]);
const isIfKeyword = is.LiteralOneOf(["base", "start", "vimscript", "lua"] as const);
type ifKeyword = u.PredicateType<typeof isIfKeyword>;

const isRawSnippet = is.ObjectOf({
  prefix: is.OptionalOf(isStringOrArray),
  body: isStringOrArray,
  description: is.OptionalOf(isStringOrArray),
  if: is.OptionalOf(isIfKeyword),
  eval: is.OptionalOf(is.String),
});

export type RawSnippet = u.PredicateType<typeof isRawSnippet>;

type BodyFunc = (denops: Denops) => string | string[] | Promise<string | string[]>;

function isBodyFunc(x: unknown): x is BodyFunc {
  return typeof x == "function";
}

type IfFunc = (denops: Denops) => boolean | Promise<boolean>;

function isIfFunc(x: unknown): x is IfFunc {
  return typeof x == "function";
}

const isTSSnippet = is.ObjectOf({
  prefix: is.OptionalOf(isStringOrArray),
  body: is.UnionOf([isStringOrArray, isBodyFunc]),
  description: is.OptionalOf(isStringOrArray),
  if: is.OptionalOf(is.UnionOf([isIfKeyword, isIfFunc])),
  eval: is.OptionalOf(is.String),
});

export type TSSnippet = u.PredicateType<typeof isTSSnippet>;

// For compatibility with VSCode global snippet files (*.code-snippets)
const isGlobalSnippet = is.ObjectOf({
  prefix: is.OptionalOf(isStringOrArray),
  body: isStringOrArray,
  description: is.OptionalOf(isStringOrArray),
  scope: is.OptionalOf(is.String),
});

export type GlobalSnippet = u.PredicateType<typeof isGlobalSnippet>;

function langToFt(lang: string): string {
  return {
    csharp: "cs",
    shellscript: "sh",
  }[lang] ?? lang;
}

export type NormalizedSnippet = {
  id: string;
  filetypes: string[];
  prefix: string[];
  body: (denops: Denops) => string | Promise<string>;
  description: string;
  if?: ifKeyword | IfFunc;
  eval?: string;
};

function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

function toString(x?: string | string[]): string {
  if (x == null) {
    return "";
  } else if (is.String(x)) {
    return x;
  } else {
    return x.join("\n");
  }
}

export class Loader {
  snippets: NormalizedSnippet[] = [];

  constructor(
    public denops: Denops,
  ) {}

  reset(): void {
    this.snippets = [];
  }

  getId(): string {
    return crypto.randomUUID();
  }

  set(snippets: NormalizedSnippet[]): void {
    this.snippets.push(...snippets);
  }

  getById(id: string): NormalizedSnippet | undefined {
    return this.snippets.find((snippet) => snippet.id === id);
  }

  async get(): Promise<NormalizedSnippet[]> {
    const ft = await op.filetype.get(this.denops);
    const snippets = this.snippets.filter((snippet) =>
      snippet.filetypes.includes(ft) || snippet.filetypes.includes("*")
    );
    return await asyncFilter(snippets, async (snippet) => {
      if (snippet.if == null) {
        return true;
      } else if (isIfFunc(snippet.if)) {
        return Boolean(await snippet.if(this.denops));
      } else if (snippet.if === "base") {
        return Boolean(await this.denops.call("denippet#load#base", snippet.prefix));
      } else if (snippet.if === "start") {
        return Boolean(await this.denops.call("denippet#load#start", snippet.prefix));
      } else if (!snippet.eval) {
        return false;
      } else if (snippet.if === "vimscript") {
        return Boolean(await this.denops.call("eval", snippet.eval));
      } else {
        return Boolean(
          await this.denops.call("luaeval", "assert(loadstring(_A[1]))()", [snippet.eval]),
        );
      }
    });
  }

  async load(
    filepath: string,
    filetype: string | string[],
  ): Promise<void> {
    const extension = filepath.split(".").pop()!;
    if (extension === "ts") {
      const content = await import(path.toFileUrl(filepath).toString())
        .then((module) => module.snippets);
      u.assert(content, is.RecordOf(isTSSnippet));
      const snippets = Object.entries(content).map(([name, snip]) => ({
        ...snip,
        id: this.getId(),
        filetypes: toArray(filetype),
        prefix: toArray(snip.prefix ?? name),
        body: async (denops: Denops) =>
          toString(typeof snip.body == "function" ? await snip.body(denops) : snip.body),
        description: toString(snip.description),
      }));
      this.set(snippets);
    } else {
      const raw = await Deno.readTextFile(filepath);
      if (["json", "toml", "yaml", "yml"].includes(extension)) {
        const content = (extension === "json")
          ? JSON.parse(raw)
          : extension === "toml"
          ? TOML.parse(raw)
          : YAML.parse(raw);
        u.assert(content, is.RecordOf(isRawSnippet));
        const snippets = Object.entries(content).map(([name, snip]) => ({
          ...snip,
          id: this.getId(),
          filetypes: toArray(filetype),
          prefix: toArray(snip.prefix ?? name),
          body: () => toString(snip.body),
          description: toString(snip.description),
        }));
        this.set(snippets);
      } else if (extension === "code-snippets") {
        const content = JSON.parse(raw);
        u.assert(content, is.RecordOf(isGlobalSnippet));
        const snippets = Object.entries(content).map(([name, snippet]) => {
          const ft = snippet.scope ? snippet.scope.split(",").map(langToFt) : ["*"];
          return {
            ...snippet,
            id: this.getId(),
            filetypes: ft,
            prefix: toArray(snippet.prefix ?? name),
            prefix_regexp: [],
            body: () => toString(snippet.body),
            description: toString(snippet.description),
          };
        });
        this.set(snippets);
      } else {
        throw new Error(`Unknown extension: ${extension}`);
      }
    }
  }
}
