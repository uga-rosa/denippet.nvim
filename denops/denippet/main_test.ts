import { Denops, fn, test } from "./deps/denops.ts";
import { assertEquals, path } from "./deps/std.ts";
import { LSP, lsputil } from "./deps/lsp.ts";
import { is } from "./deps/unknownutil.ts";

async function loadPlugin(denops: Denops): Promise<void> {
  const runtimepath = path.resolve(path.fromFileUrl(new URL("../..", import.meta.url)));
  await denops.cmd(`set runtimepath^=${runtimepath}`);
  await denops.call("denops#plugin#discover");
  await denops.call("denops#plugin#wait", "denippet");
}

async function input(
  denops: Denops,
  body: string | string[],
  maps: string[],
): Promise<void> {
  let cmd = `a\\<Cmd>call denippet#anonymous(<body>)\\<CR>`;
  if (is.String(body)) {
    cmd = cmd.replace("<body>", `'${body}'`);
  } else {
    body = "[" + body.map((b) => `'${b}'`).join(",") + "]";
    cmd = cmd.replace("<body>", `${body}`);
  }
  cmd += maps.join("");
  await denops.cmd(`call feedkeys("${cmd}", 'x')`);
  await denops.cmd("do ModeChanged *:n");
}

const map = {
  expand: "\\<Cmd>call denippet#expand()\\<CR>",
  jumpNext: "\\<Cmd>call denippet#jump(+1)\\<CR>",
  jumpPrev: "\\<Cmd>call denippet#jump(-1)\\<CR>",
  choiceNext: "\\<Cmd>call denippet#choice(+1)\\<CR>",
  choicePrev: "\\<Cmd>call denippet#choice(-1)\\<CR>",
};

function parseBuffer(
  buffer: string[],
): { buffer: string[]; cursor: LSP.Position } {
  for (let i = 0; i < buffer.length; i++) {
    const col = buffer[i].indexOf("|");
    if (col >= 0) {
      buffer[i] = buffer[i].replace("|", "");
      // Cursor moves one position to the left when exiting insert mode.
      return { buffer, cursor: { line: i, character: col > 0 ? col - 1 : 0 } };
    }
  }
  throw new Error("Not found cursor mark (`|`)");
}

type Spec = {
  name: string;
  body: string | string[];
  maps: string[];
  expectBuffer: string[];
};

test({
  mode: "all",
  name: "E2E",
  fn: async (denops, t) => {
    await loadPlugin(denops);

    const specs: Spec[] = [
      {
        name: "$0",
        body: "console.log($0)",
        maps: [],
        expectBuffer: ["console.log(|)"],
      },
      {
        name: "jump",
        body: "$1 $2",
        maps: ["foo", map.jumpNext, "bar"],
        expectBuffer: ["foo bar|"],
      },
      {
        name: "copy",
        body: "$1 $1",
        maps: ["bar"],
        expectBuffer: ["bar| bar"],
      },
      {
        name: "default",
        body: "${1:foo}",
        maps: ["\\<Esc>"],
        expectBuffer: ["foo|"],
      },
      {
        name: "multi line",
        body: ["if ($1) {", "\t$0", "}"],
        maps: ["foo", map.jumpNext, "bar"],
        expectBuffer: ["if (foo) {", "\tbar|", "}"],
      },
      {
        name: "nest (jump)",
        body: ["if ($1) {", "\t$0", "}"],
        maps: [
          "foo",
          "\\<Cmd>call denippet#anonymous(['if ($1) {', '\t$0', '}'])\\<CR>",
          "bar",
          map.jumpNext,
          "baz",
          map.jumpNext,
          "qux",
        ],
        expectBuffer: ["if (fooif (bar) {", "\tbaz", "}) {", "\tqux|", "}"],
      },
      {
        name: "nest (range)",
        body: ["if ($1) {", "\t$0", "}"],
        maps: [
          "x",
          "\\<Cmd>call denippet#anonymous(' == null')\\<CR>",
          map.jumpNext,
          "foo",
          map.jumpPrev,
          "bar",
        ],
        expectBuffer: ["if (bar|) {", "\tfoo", "}"],
      },
      {
        name: "multibyte",
        body: "あ$1う$2お",
        maps: ["い", map.jumpNext, "え"],
        expectBuffer: ["あいうえ|お"],
      },
      {
        name: "choiceNext",
        body: "${1|foo,bar,baz|}",
        maps: [map.choiceNext, map.choiceNext],
        expectBuffer: ["baz|"],
      },
      {
        name: "choicePrev (loop)",
        body: "${1|foo,bar,baz|}",
        maps: [map.choicePrev],
        expectBuffer: ["baz|"],
      },
      {
        name: "nested placeholders",
        body: "console.log($1${2:, $1})",
        maps: ["foo"],
        expectBuffer: ["console.log(foo|, foo)"],
      },
      {
        name: "regex (update on InsertLeave)",
        body: "$1 ${1/(.)(.)(.)/$3$2$1/}",
        maps: ["abc", "\\<Esc>"],
        expectBuffer: ["abc| cba"],
      },
      {
        name: "regex (update on jump)",
        body: "$1 ${1/(.)(.)(.)/$3$2$1/} $2",
        maps: ["abc", map.jumpNext, "foo"],
        expectBuffer: ["abc cba foo|"],
      },
    ];

    for (const spec of specs) {
      await t.step({
        name: spec.name,
        fn: async () => {
          await fn.deletebufline(denops, "%", 1, "$");
          await input(denops, spec.body, spec.maps);
          const { buffer: expectBuffer, cursor: expectCursor } = parseBuffer(spec.expectBuffer);
          const actualBuffer = await fn.getline(denops, 1, "$");
          const actualCursor = await lsputil.getCursor(denops);
          assertEquals(actualBuffer, expectBuffer);
          assertEquals(actualCursor, expectCursor);
        },
      });
    }
  },
});
