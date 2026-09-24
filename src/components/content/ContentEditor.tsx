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
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  DragHandleButton,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useExtensionState,
} from "@blocknote/react";
import { BlockNoteView, ShadCNDefaultComponents } from "@blocknote/shadcn";
import { Link as LinkIcon, Plus } from "lucide-react";
import type { ContentBlock, PageDetail } from "@/lib/content";
import {
  multiLineInsertion,
  pasteTarget,
  planEmbedPaste,
  planEmbedTextInput,
  uriListText,
  type EmbedBlockType,
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

/**
 * A block for every type the paste planner can produce, keyed by that type,
 * so a card the planner knows about but the schema does not is a compile
 * error rather than a paste that silently drops its block.
 */
const embedBlockSpecs = {
  tweet: tweetBlock(),
  bookmark: bookmarkBlock(),
} satisfies Record<EmbedBlockType, unknown>;

const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...noteBlockSpecs,
    ...embedBlockSpecs,
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
 * The selection's verdict on whether deleting it leaves the caret's
 * paragraph with nothing in it, or null when there is no selection to ask.
 *
 * The test is the offsets at both ends, not which blocks they sit in, so it
 * holds across a block boundary — `deleteSelection` merges what it crosses,
 * and only text outside the selection survives that merge. Four cases
 * follow: the whole of one textblock is empty afterwards; a selection from
 * the very start of one block to the very end of another leaves a single
 * empty block, so the card still lands; select-all is the same answer by
 * the same measure, its ends resolving to the document rather than to any
 * textblock; anything else — part of a block, part of a block across a
 * boundary, a node selection — leaves text behind and is not empty, however
 * blank the caret's own block looks.
 */
function selectionLeavesBlockEmpty(editor: NoteEditor): boolean | null {
  const { selection } = editor.prosemirrorState;
  if (selection.empty) return null;
  const { $from, $to } = selection;
  // Ctrl/Cmd+A spans the document itself, so both ends sit at depth 0 with
  // the document as their parent and the offset test below still reads
  // true. Every other selection has to end inside text for the offsets to
  // mean anything.
  const spansDocument = $from.depth === 0 && $to.depth === 0;
  if (!spansDocument && (!$from.parent.isTextblock || !$to.parent.isTextblock))
    return false;
  return $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
}

/**
 * Puts a planned embed into the document, or reports that there was nothing
 * to plan so the caller can let the editor handle the text itself.
 *
 * The plan is made once, before anything is touched, on what the paragraph
 * will hold after the selection goes: a paragraph the selection empties is
 * replaced, a paragraph that keeps text around the selection takes the
 * embed after it. Deciding first matters because the callers treat a false
 * return as "the editor still owns this text" — `handleTextInput` inserts
 * it at positions it resolved before this ran — so returning false after a
 * mutation would drop or misplace what the user typed.
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
    cursor = pasteTarget(block, selectionLeavesBlockEmpty(editor));
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
    if (planned.kind === "replace") {
      // replaceBlocks would drop indented children unless they travel with the embed.
      editor.replaceBlocks([block], [
        {
          type: planned.type,
          props: { url: planned.url },
          children: block.children,
        },
      ]);
    } else {
      editor.insertBlocks(
        [{ type: planned.type, props: { url: planned.url } }],
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

/**
 * The side menu's + button. BlockNote's own inserts a paragraph and then
 * opens the block-type menu with Heading 1 selected, so the Enter that
 * usually follows turns the new line into a heading, and on an empty block
 * it converts that block instead of adding a line. This one only adds an
 * empty paragraph and puts the caret in it: above the hovered block on a
 * click, below it on an Alt+click. The block types stay a keystroke away:
 * type / on the new line.
 */
function AddLineButton() {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  if (block === undefined) return null;
  return (
    <Components.SideMenu.Button
      className="bn-button"
      label={dict.side_menu.add_block_label}
      icon={<Plus size={24} />}
      onClick={(event) => {
        const [inserted] = editor.insertBlocks(
          [{ type: "paragraph" }],
          block,
          event.altKey ? "after" : "before",
        );
        if (!inserted) return;
        editor.setTextCursorPosition(inserted);
        editor.focus();
      }}
    />
  );
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
    // A clipboard that is only a URL becomes an embed: the block its own
    // matcher claims, a bookmark card on an empty paragraph for anything
    // else. Mixed content and code blocks fall through so ordinary paste is
    // unchanged.
    pasteHandler: ({ event, editor: current, defaultPasteHandler }) => {
      const plain = event.clipboardData?.getData("text/plain");
      // Only the uri-list flavour carries `#` comment lines; a `#` in plain
      // text is a hashtag or a heading and stays.
      const text =
        plain || uriListText(event.clipboardData?.getData("text/uri-list") || "");
      return applyEmbedPlan(current, text, planEmbedPaste) || defaultPasteHandler();
    },
    _tiptapOptions: {
      editorProps: {
        // Mobile keyboards deliver a clipboard URL as an insertion rather
        // than a paste event, so `pasteHandler` above never runs and the URL
        // stays a bare link. ProseMirror reads such an insertion — whether it
        // reaches it as `beforeinput` or as a DOM change — here, and the
        // planner sorts an insert from typing.
        handleTextInput: (view, from, _to, text, deflt) => {
          const current = editorRef.current;
          if (current && applyEmbedPlan(current, text, planEmbedTextInput)) return true;
          // What is left is inserted as text. A keystroke is one character;
          // anything longer that could hold a link is a keyboard's clipboard
          // or suggestion insert, and it gets the link paste rule a paste
          // would, so a URL inside it is a link rather than bare text. Other
          // insertions stay with the editor and its input rules.
          if (text.length < 2 || !/:\/\/|\.\S/.test(text)) return false;
          view.dispatch(deflt().setMeta("applyPasteRules", { from, text }));
          return true;
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
            // A lone URL with a trailing newline is one of the forms a phone
            // hands over, so the embed plan gets first refusal.
            if (applyEmbedPlan(current, text, planEmbedTextInput)) return true;
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
    // BlockNote hides the side menu from a document keydown listener. Stop a
    // bare Alt at window first, only while the menu is visible, so the + button
    // survives an Alt+click.
    const keepSideMenuOnAlt = (event: KeyboardEvent) => {
      if (!editable) return;
      if (event.key !== "Alt") return;
      if (!host.querySelector(".bn-side-menu")) return;
      event.stopPropagation();
    };
    host.addEventListener("keydown", keydown, true);
    window.addEventListener("keydown", keepSideMenuOnAlt, true);
    return () => {
      host.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keydown", keepSideMenuOnAlt, true);
    };
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
        sideMenu={false}
      >
        <SideMenuController
          sideMenu={(props) => (
            <SideMenu {...props}>
              <AddLineButton />
              <DragHandleButton {...props} />
            </SideMenu>
          )}
        />
      </BlockNoteView>
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
