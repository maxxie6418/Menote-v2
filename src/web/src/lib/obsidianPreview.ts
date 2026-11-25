import { obsidianAnchor, obsidianHighlight, obsidianText, type ObsidianAstNode } from "./obsidianMarkdown";

const CALLOUT_TITLES: Record<string, string> = {
  note: "笔记", abstract: "摘要", info: "信息", todo: "待办", tip: "提示", success: "成功",
  question: "问题", warning: "注意", failure: "失败", danger: "危险", bug: "问题", example: "示例", quote: "引用",
};

function element(hName: string, children: ObsidianAstNode[], hProperties?: Record<string, unknown>): ObsidianAstNode {
  return { type: "obsidianRender", children, data: { hName, hProperties } };
}

function addId(node: ObsidianAstNode, id: string): void {
  node.data = { ...node.data, hProperties: { ...(node.data?.hProperties as object), id } };
}

function isOnly(node: ObsidianAstNode, type: string): ObsidianAstNode | undefined {
  const useful = node.children?.filter((child) => child.type !== "text" || child.value?.trim());
  return useful?.length === 1 && useful[0]?.type === type ? useful[0] : undefined;
}

export function remarkObsidianPreview() {
  return (tree: unknown) => {
    const root = tree as ObsidianAstNode;
    const footnotes: ObsidianAstNode[] = [];
    const headings: string[] = [];
    const existingFootnotes = new Set(root.children?.filter((node) => node.type === "footnoteDefinition").map((node) => node.identifier));
    const previewChildren = (children: ObsidianAstNode[]): ObsidianAstNode[] => {
      const result: ObsidianAstNode[] = [];
      for (const child of children) {
        const standaloneMarker = child.type === "paragraph" ? isOnly(child, "obsidianBlockId") : undefined;
        const anchor = standaloneMarker && obsidianAnchor({ blockId: standaloneMarker.id });
        if (anchor && result.length > 0) {
          addId(result.at(-1)!, anchor);
          continue;
        }
        const standaloneEmbed = child.type === "paragraph" ? isOnly(child, "obsidianWikiEmbed") : undefined;
        const converted = preview(standaloneEmbed ?? child, !!standaloneEmbed);
        if (converted) result.push(converted);
      }
      return result;
    };

    const preview = (node: ObsidianAstNode, standalone = false): ObsidianAstNode | null => {
      switch (node.type) {
        case "obsidianBlockId":
        case "obsidianComment":
        case "obsidianBlockComment":
          return null;
        case "obsidianTag":
          return element("span", [{ type: "text", value: node.raw ?? `#${node.tag}` }], { dataObsidianTag: node.tag });
        case "link":
        case "linkReference": {
          const plainTags = (child: ObsidianAstNode): ObsidianAstNode => child.type === "obsidianTag"
            ? { type: "text", value: child.raw ?? `#${child.tag}` }
            : child.children ? { ...child, children: child.children.map(plainTags) } : child;
          return { ...node, children: previewChildren((node.children ?? []).map(plainTags)) };
        }
        case "obsidianHighlight": {
          const { color, content } = obsidianHighlight(node);
          return element("mark", previewChildren(content), { className: ["mn-obsidian-highlight"], dataHighlightColor: color });
        }
        case "obsidianWikilink":
        case "obsidianWikiEmbed": {
          const target = node.linkTarget;
          return element(standalone ? "div" : "span", previewChildren(node.children ?? []), {
            dataObsidianReference: node.type === "obsidianWikiEmbed" ? "embed" : "link",
            dataObsidianPath: target?.path ?? "",
            dataObsidianHeading: target?.heading,
            dataObsidianBlock: target?.blockId,
            dataObsidianWidth: node.embedSize?.width,
            dataObsidianHeight: node.embedSize?.height,
            dataObsidianPage: target?.params?.page,
          });
        }
        case "obsidianInlineFootnote": {
          let id = `menote-inline-${footnotes.length + 1}`;
          while (existingFootnotes.has(id)) id += "-1";
          existingFootnotes.add(id);
          footnotes.push({ type: "footnoteDefinition", identifier: id, label: id,
            children: [{ type: "paragraph", children: previewChildren(node.children ?? []) }] });
          return { type: "footnoteReference", identifier: id, label: id };
        }
        case "obsidianCallout": {
          const kind = node.kind ?? "note";
          const title = node.title || CALLOUT_TITLES[kind] || kind;
          const head = element(node.fold ? "summary" : "div", [{ type: "text", value: title }], { className: ["mn-obsidian-callout-title"] });
          const body = element("div", previewChildren(node.children ?? []), { className: ["mn-obsidian-callout-body"] });
          return element(node.fold ? "details" : "aside", [head, body], {
            className: ["mn-obsidian-callout"], dataCallout: kind, open: node.fold === "open" ? true : undefined,
          });
        }
      }
      const blockId = node.children?.find((child) => child.type === "obsidianBlockId")?.id;
      const heading = node.type === "heading" ? obsidianText(node) : undefined;
      const anchor = obsidianAnchor({ blockId, heading });
      if (anchor) addId(node, anchor);
      if (node.children) node.children = previewChildren(node.children);
      if (heading && node.depth) {
        headings.length = node.depth;
        headings[node.depth - 1] = heading;
        const path = headings.filter(Boolean);
        const aliases = path.slice(0, -1).map((_part, index) => obsidianAnchor({ heading: path.slice(index).join("#") }));
        if (blockId) aliases.push(obsidianAnchor({ heading }));
        node.children?.unshift(...aliases.map((id) => element("span", [], { id, ariaHidden: true })));
      }
      return node;
    };

    root.children = [...previewChildren(root.children ?? []), ...footnotes];
  };
}
