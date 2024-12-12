import { Loader } from "./loader.ts";
import { op, test } from "./deps/denops.ts";
import { assertEquals, path } from "./deps/std.ts";

const pluginRoot = path.fromFileUrl(new URL("../..", import.meta.url));
const testDataDir = path.join(pluginRoot, "test", "data");

test({
  mode: "all",
  name: "loader",
  fn: async (denops, t) => {
    const loader = new Loader(denops);

    await loader.load(path.join(testDataDir, "global.json"), "*");
    await loader.load(path.join(testDataDir, "typescript.toml"), "typescript");
    await loader.load(path.join(testDataDir, "lua.yaml"), "lua");
    await loader.load(path.join(testDataDir, "ruby.yml"), "ruby");
    await loader.load(path.join(testDataDir, "vim.ts"), "vim");
    await loader.load(path.join(testDataDir, "global.code-snippets"), "*");

    await t.step({
      name: "global",
      fn: async () => {
        const ft = "";
        await op.filetype.set(denops, ft);
        const snippets = await loader.get();
        assertEquals(snippets.length, 1);
      },
    });

    await t.step({
      name: "toml",
      fn: async () => {
        const ft = "typescript";
        await op.filetype.set(denops, ft);
        const snippets = await loader.get();
        assertEquals(snippets.length, 3);
      },
    });

    await t.step({
      name: "yaml",
      fn: async () => {
        const ft = "lua";
        await op.filetype.set(denops, ft);
        const snippets = await loader.get();
        assertEquals(snippets.length, 4);
      },
    });

    await t.step({
      name: "yml",
      fn: async () => {
        const ft = "ruby";
        await op.filetype.set(denops, ft);
        const snippets = await loader.get();
        assertEquals(snippets.length, 3);
      },
    });

    await t.step({
      name: "typescript",
      fn: async () => {
        const ft = "vim";
        await op.filetype.set(denops, ft);
        const snippets = await loader.get();
        assertEquals(snippets.length, 2);
      },
    });

    await t.step({
      name: "code-snippets",
      fn: async () => {
        {
          const ft = "foo";
          await op.filetype.set(denops, ft);
          const snippets = await loader.get();
          assertEquals(snippets.length, 2);
        }
        {
          const ft = "bar";
          await op.filetype.set(denops, ft);
          const snippets = await loader.get();
          assertEquals(snippets.length, 2);
        }
      },
    });
  },
});
