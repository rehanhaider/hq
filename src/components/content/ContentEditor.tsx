import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type BlockNoteEditor,
  type PartialBlock,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView, ShadCNDefaultComponents } from "@blocknote/shadcn";
import { Link as LinkIcon } from "lucide-react";
import type { ContentBlock, PageDetail } from "@/lib/content";
import {
  multiLineInsertion,
  pasteTarget,
  planEmbedPaste,
  planEmbedTextInput,
  type EmbedPastePlan,
} from "@/lib/embedPaste";
import { MAX_UPLOAD_BYTES, formatBytes, uploadRejection } from "@/lib/uploads";
import { bookmarkBlock } from "./BookmarkBlock";
import { tweetBlock } from "./TweetBlock";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUI } from "@/store/ui";

const {
  audio: _audio,
  divider: _divider,
  toggleListItem: _toggleListItem,
  ...noteBlockSpecs
} = defaultBlockSpecs;
const { bold, italic, underline } = defaultStyleSpecs;

const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...noteBlockSpecs,
    tweet: tweetBlock(),
    bookmark: bookmarkBlock(),
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: { bold, italic, underline },
});

type NoteEditor = BlockNoteEditor<
  typeof noteSchema.blockSchema,
  typeof noteSchema.inlineContentSchema,
  typeof noteSchema.styleSchema
>;

/**
 * Puts a planned embed into the document, or reports that there was nothing
 * to plan so the caller can let the editor handle the text itself.
 *
 * A non-empty selection is deleted first, matching ordinary paste, and the
 * plan is made again on what is left: a paragraph emptied by that deletion
 * is replaced, a paragraph with text around the selection keeps its text
 * and takes the embed after it.
 */
function applyEmbedPlan(
  editor: NoteEditor,
  text: string,
  plan: (
    text: string,
    current: { type: string; empty: boolean } | null,
  ) => EmbedPastePlan,
): boolean {
  let cursor: { type: string; empty: boolean } | null = null;
  try {
    const { block } = editor.getTextCursorPosition();
    cursor = pasteTarget(block, editor.prosemirrorState.selection.empty);
  } catch {
    cursor = null;
  }
  const planned = plan(text, cursor);
  if (planned.kind === "ignore") return false;
  try {
    editor.transact((tr) => {
      if (!tr.selection.empty) tr.deleteSelection();
    });
    const { block } = editor.getTextCursorPosition();
    const after = plan(planned.url, pasteTarget(block, true));
    if (after.kind === "ignore") return false;
    if (after.kind === "replace") {
      // replaceBlocks would drop indented children unless they travel with the embed.
      editor.replaceBlocks([block], [
        {
          type: after.type,
          props: { url: after.url },
          children: block.children,
        },
      ]);
    } else {
      editor.insertBlocks(
        [{ type: after.type, props: { url: after.url } }],
        block,
        "after",
      );
    }
    return true;
  } catch {
    return false;
  }
}

const DefaultDropdownMenuTrigger =
  ShadCNDefaultComponents.DropdownMenu.DropdownMenuTrigger;

function DragSafeDropdownMenuTrigger({
  render,
  ...props
}: ComponentProps<typeof DefaultDropdownMenuTrigger>) {
  type DraggableTriggerProps = {
    draggable?: boolean;
    onMouseDown?: (event: ReactMouseEvent<HTMLElement>) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  if (
    !isValidElement<DraggableTriggerProps>(render) ||
    !render.props.draggable
  )
    return <DefaultDropdownMenuTrigger render={render} {...props} />;

  const { onMouseDown, onClick } = render.props;
  const child = cloneElement(render, {
    onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
      onMouseDown?.(event);
      if (event.defaultPrevented) return;
      (
        event as ReactMouseEvent<HTMLElement> & {
          preventBaseUIHandler?: () => void;
        }
      ).preventBaseUIHandler?.();
    },
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && event.detail > 0)
        event.currentTarget.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
    },
  });

  return <DefaultDropdownMenuTrigger render={child} {...props} />;
}

function normalizedLink(value: string) {
  const link = value.trim();
  if (!link) return null;
  if (/^(https?:|mailto:|tel:|\/|#|\?|\.\/|\.\.\/)/i.test(link)) return link;
  if (/^[a-z][a-z\d+.-]*:/i.test(link)) return null;
  return `https://${link}`;
}

export function ContentEditor({
  page,
  editable = true,
  onDocumentChange,
  onUploadStart,
  onUploadEnd,
}: {
  page: PageDetail;
  editable?: boolean;
  onDocumentChange: (document: ContentBlock[]) => void;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
}) {
  const ui = useUI();
  const editorHost = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const linkPosition = useRef<number | undefined>(undefined);
  const editingExistingLink = useRef(false);
  const pageId = page.id;
  const onUploadStartRef = useRef(onUploadStart);
  const onUploadEndRef = useRef(onUploadEnd);
  const onDocumentChangeRef = useRef(onDocumentChange);
  onUploadStartRef.current = onUploadStart;
  onUploadEndRef.current = onUploadEnd;
  onDocumentChangeRef.current = onDocumentChange;
  const editorRef = useRef<NoteEditor | null>(null);

  /**
   * Where a pasted, dropped, or chosen file goes. The editor only learns that
   * an upload failed, so the reason is kept here and shown under the page.
   *
   * The URL is written onto the block before this returns, so a page change
   * that waited for the POST still has something to save. BlockNote would do
   * the same write after we return, which is then a no-op.
   */
  const uploadFile = useCallback(
    async (selected: File, blockId?: string) => {
      const refusal = uploadRejection({
        name: selected.name,
        mime: selected.type,
        size: selected.size,
      });
      if (refusal) {
        setUploadError(refusal);
        throw new Error(refusal);
      }
      onUploadStartRef.current?.();
      const body = new FormData();
      body.append("file", selected);
      body.append("pageId", pageId);
      try {
        const response = await fetch("/api/uploads", { method: "POST", body });
        const payload = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !payload?.url)
          throw new Error(payload?.error || "The file could not be uploaded.");
        const current = editorRef.current;
        if (blockId && current?.getBlock(blockId)) {
          current.updateBlock(blockId, { props: { url: payload.url } });
          onDocumentChangeRef.current(current.document as unknown as ContentBlock[]);
        }
        setUploadError("");
        return payload.url;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "The file could not be uploaded.";
        setUploadError(message);
        throw new Error(message);
      } finally {
        onUploadEndRef.current?.();
      }
    },
    [pageId],
  );

  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: page.document as PartialBlock<
      typeof noteSchema.blockSchema,
      typeof noteSchema.inlineContentSchema,
      typeof noteSchema.styleSchema
    >[],
    links: {
      isValidLink: (href) => normalizedLink(href) === href,
    },
    uploadFile,
    defaultStyles: true,
    // A clipboard that is only a URL becomes an embed: a tweet block for a
    // tweet, a bookmark card on an empty paragraph for anything else. Mixed
    // content and code blocks fall through so ordinary paste is unchanged.
    pasteHandler: ({ event, editor: current, defaultPasteHandler }) =>
      applyEmbedPlan(
        current,
        event.clipboardData?.getData("text/plain") ||
          event.clipboardData?.getData("text/uri-list") ||
          "",
        planEmbedPaste,
      ) || defaultPasteHandler(),
    _tiptapOptions: {
      editorProps: {
        // Mobile keyboards deliver a clipboard URL as an insertion rather
        // than a paste event, so `pasteHandler` above never runs and the
        // tweet stays a bare link. ProseMirror reads such an insertion —
        // whether it reaches it as `beforeinput` or as a DOM change — here.
        handleTextInput: (_view, _from, _to, text) => {
          const current = editorRef.current;
          return current
            ? applyEmbedPlan(current, text, planEmbedTextInput)
            : false;
        },
        handleDOMEvents: {
          // A multi-line insertion from a mobile keyboard never reaches
          // `pasteHandler` either, and Chrome splits it into sibling
          // paragraphs inside one block, of which ProseMirror keeps only
          // the first. Take the text before the DOM changes and paste it,
          // so it lands the way the same text would from a paste event.
          beforeinput: (_view, event) => {
            const current = editorRef.current;
            const text = multiLineInsertion(
              event.inputType,
              event.data ?? event.dataTransfer?.getData("text/plain"),
            );
            if (!current || text === null) return false;
            event.preventDefault();
            let inCodeBlock = false;
            try {
              inCodeBlock = current.getTextCursorPosition().block.type === "codeBlock";
            } catch {
              inCodeBlock = false;
            }
            if (inCodeBlock) current.pasteText(text);
            else current.pasteMarkdown(text);
            return true;
          },
        },
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    const host = editorHost.current;
    if (!host) return;
    const keydown = (event: KeyboardEvent) => {
      if (!editable) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopPropagation();
      const position = editor.prosemirrorState.selection.from;
      const existing = editor.getLinkMarkAtPos(position);
      linkPosition.current = position;
      editingExistingLink.current = Boolean(existing);
      setLinkUrl(existing?.href ?? editor.getSelectedLinkUrl() ?? "");
      setLinkText(existing?.text ?? editor.getSelectedText());
      setLinkError("");
      setLinkOpen(true);
    };
    host.addEventListener("keydown", keydown, true);
    return () => host.removeEventListener("keydown", keydown, true);
  }, [editable, editor]);

  const saveLink = () => {
    const href = normalizedLink(linkUrl);
    if (!href) {
      setLinkError("Enter an http, https, mail, phone, or relative link.");
      return;
    }
    if (!linkText.trim()) {
      setLinkError("Enter the text to display.");
      return;
    }
    if (editingExistingLink.current)
      editor.editLink(href, linkText.trim(), linkPosition.current);
    else {
      editor.focus();
      editor.createLink(href, linkText.trim());
    }
    setLinkOpen(false);
    editor.focus();
  };

  return (
    <div className="content-editor-shell" ref={editorHost}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={ui.theme}
        shadCNComponents={{
          DropdownMenu: {
            ...ShadCNDefaultComponents.DropdownMenu,
            DropdownMenuTrigger: DragSafeDropdownMenuTrigger,
          },
        }}
        onChange={(current) =>
          onDocumentChange(current.document as unknown as ContentBlock[])
        }
        className="min-h-112"
        data-testid="content-editor"
      />
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground sm:px-4">
        <span>Type / for blocks, or drop an image, video, or file onto the page.</span>
        <span className="ml-auto hidden sm:inline">Up to {formatBytes(MAX_UPLOAD_BYTES)} a file</span>
      </div>
      {uploadError && (
        <p className="bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">
          {uploadError}
        </p>
      )}
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (!open) requestAnimationFrame(() => editor.focus());
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="size-4" /> {editingExistingLink.current ? "Edit link" : "Insert link"}
            </DialogTitle>
            <DialogDescription>Add a safe link to the selected text.</DialogDescription>
          </DialogHeader>
          <div>
            <label className="mt-4 block text-xs font-medium" htmlFor="page-link-text">Link text</label>
            <Input id="page-link-text" className="mt-1" value={linkText} onChange={(event) => setLinkText(event.target.value)} />
            <label className="mt-3 block text-xs font-medium" htmlFor="page-link-url">Link URL</label>
            <Input
              id="page-link-url"
              className="mt-1"
              autoFocus
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveLink();
                }
              }}
            />
            {linkError && <p className="mt-2 text-xs text-destructive" role="alert">{linkError}</p>}
          </div>
          <DialogFooter>
            {editingExistingLink.current && (
              <Button
                variant="ghost"
                onClick={() => {
                  editor.deleteLink(linkPosition.current);
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button onClick={saveLink}>Save link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
