import { b, Denops, op } from "./deps/denops.ts";
import { lsputil } from "./deps/lsp.ts";
import { is } from "./deps/unknownutil.ts";
import * as Node from "./node.ts";
import { parse } from "./parser.ts";
import { linePatch } from "./util.ts";

export type Dir = 1 | -1;

export class Snippet {
  nodeIndex = 0;

  constructor(
    public denops: Denops,
    public snippet: Node.Snippet,
    public jumpableNodes: Node.Jumpable[],
    public outer?: Snippet,
  ) {}

  static async create(
    denops: Denops,
    body: string,
    outer?: Snippet,
    prefix?: string,
  ): Promise<Snippet> {
    const snippetNode = await parse(denops, body);

    // Resolve reference relationships using breadth first search.
    const isJumpable = (
      token: Node.Node,
    ): token is Node.Tabstop | Node.Placeholder | Node.Choice => token.isJumpable();
    const nodeQueue = snippetNode.children.filter((node) => node.type !== "text");
    // Key is tabstop
    const jumpableNodeMap = new Map<number, Node.Jumpable>();
    while (true) {
      const node = nodeQueue.shift();
      if (!node) {
        break;
      }

      if (is.ObjectOf({ children: is.Array })(node)) {
        nodeQueue.push(...node.children.filter(isJumpable));
      }

      if (!node.isJumpable()) {
        continue;
      }

      const existNode = jumpableNodeMap.get(node.tabstop);
      if (!existNode) {
        jumpableNodeMap.set(node.tabstop, node);
      } else if (node.getPriority() > existNode.getPriority()) {
        existNode.copy = node;
        jumpableNodeMap.set(node.tabstop, node);
      } else {
        node.copy = existNode;
      }
    }

    // Sort in ascending order by tabstop.
    const jumpableNodes = [...jumpableNodeMap.entries()]
      .sort((a, b) => {
        if (a[0] === 0) {
          return 1;
        } else if (b[0] === 0) {
          return -1;
        }
        return a[0] - b[0];
      })
      .map((entry) => entry[1]);

    // Store the cursor position before do linePatch
    const cursor = await lsputil.getCursor(denops);
    cursor.character -= prefix?.length ?? 0;
    // Set the text to the buffer
    const insertText = await snippetNode.getText();
    await linePatch(denops, prefix?.length ?? 0, 0, insertText);

    // Calculate range each node
    await snippetNode.updateRange(cursor);

    // Jump to the first node
    await jumpableNodes[0]?.jump();

    const snippet = new Snippet(denops, snippetNode, jumpableNodes, outer);
    return snippet;
  }

  currentNode(): Node.Jumpable {
    return this.jumpableNodes[this.nodeIndex];
  }

  async update(tabstop?: number): Promise<void> {
    await this.currentNode().updateInput();
    const eventignore = await op.eventignore.get(this.denops);
    try {
      await op.eventignore.set(this.denops, "all");
      await this.snippet.updateRange(undefined, tabstop);
    } finally {
      await op.eventignore.set(this.denops, eventignore);
    }
    // Extmark could disappear with updateRange().
    await this.currentNode().setExtmark();
    await this.setVar();
  }

  jumpable(dir: Dir): boolean {
    if (dir === 1 && this.nodeIndex < this.jumpableNodes.length - 1) {
      return true;
    } else if (dir === -1 && this.nodeIndex > 0) {
      return true;
    } else {
      return !!this.outer?.jumpable(dir);
    }
  }

  async jump(dir: Dir): Promise<boolean> {
    if (dir === 1 && this.nodeIndex < this.jumpableNodes.length - 1) {
      this.nodeIndex++;
    } else if (dir === -1 && this.nodeIndex > 0) {
      this.nodeIndex--;
    } else {
      return false;
    }
    await this.snippet.updateRange(undefined, this.currentNode().tabstop);
    await this.doNodeLeave();
    await this.currentNode().jump();
    await this.doNodeEnter();
    return true;
  }

  choosable(): boolean {
    return this.currentNode().type === "choice";
  }

  async choice(dir: Dir): Promise<void> {
    const node = this.currentNode();
    if (!isChoiceNode(node)) {
      return;
    }
    if (dir === 1) {
      node.selectNext();
    } else {
      node.selectPrev();
    }
    await this.snippet.updateRange();
    await this.setVar();
    await this.denops.cmd("do User DenippetChoiceSelected");
  }

  async setVar(): Promise<void> {
    await b.set(this.denops, "denippet_current_node", this.currentNode());
  }

  async clearVar(): Promise<void> {
    await b.set(this.denops, "denippet_current_node", {});
  }

  async doNodeEnter(): Promise<void> {
    await this.setVar();
    await this.denops.cmd("do User DenippetNodeEnter");
  }

  async doNodeLeave(): Promise<void> {
    await this.denops.cmd("do User DenippetNodeLeave");
    await this.clearVar();
  }
}

function isChoiceNode(node: Node.Jumpable): node is Node.Choice {
  return node.type === "choice";
}
