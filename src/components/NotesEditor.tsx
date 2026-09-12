import {
  cloneElement,
  isValidElement,
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
  type PartialBlock,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView, ShadCNDefaultComponents } from "@blocknote/shadcn";
import { Download, Link as LinkIcon, Upload } from "lucide-react";
import { validateNoteDocument, type NoteBlock, type NoteDetail } from "@/lib/notes";
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
  file: _file,
  image: _image,
  toggleListItem: _toggleListItem,
  video: _video,
  ...noteBlockSpecs
} = defaultBlockSpecs;
const { bold, italic, underline } = defaultStyleSpecs;

const noteSchema = BlockNoteSchema.create({
  blockSpecs: noteBlockSpecs,
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: { bold, italic, underline },
});

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

function downloadName(title: string) {
  const safe = title.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${safe || "note"}.md`;
}

function normalizedLink(value: string) {
  const link = value.trim();
  if (!link) return null;
  if (/^(https?:|mailto:|tel:|\/|#|\?|\.\/|\.\.\/)/i.test(link)) return link;
  if (/^[a-z][a-z\d+.-]*:/i.test(link)) return null;
  return `https://${link}`;
}

export function NotesEditor({
  note,
  onDocumentChange,
}: {
  note: NoteDetail;
  onDocumentChange: (document: NoteBlock[]) => void;
}) {
  const ui = useUI();
  const file = useRef<HTMLInputElement>(null);
  const editorHost = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [importError, setImportError] = useState("");
  const linkPosition = useRef<number | undefined>(undefined);
  const editingExistingLink = useRef(false);
  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: note.document as PartialBlock<
      typeof noteSchema.blockSchema,
      typeof noteSchema.inlineContentSchema,
      typeof noteSchema.styleSchema
    >[],
    links: {
      isValidLink: (href) => normalizedLink(href) === href,
    },
    defaultStyles: true,
  });

  useEffect(() => {
    const host = editorHost.current;
    if (!host) return;
    const keydown = (event: KeyboardEvent) => {
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
  }, [editor]);

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

  const exportMarkdown = () => {
    const markdown = editor.blocksToMarkdownLossy();
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadName(note.title);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="notes-editor-shell" ref={editorHost}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          <Upload /> Import .md
        </Button>
        <input
          ref={file}
          className="sr-only"
          type="file"
          accept=".md,text/markdown,text/plain"
          aria-label="Import Markdown file"
          onChange={async (event) => {
            const input = event.currentTarget;
            const selected = input.files?.[0];
            if (!selected) return;
            const original = editor.document;
            try {
              const blocks = editor.tryParseMarkdownToBlocks(await selected.text());
              if (!validateNoteDocument(blocks))
                throw new Error("This Markdown file contains content Notes cannot save.");
              editor.replaceBlocks(editor.document, blocks);
              onDocumentChange(editor.document as unknown as NoteBlock[]);
              setImportError("");
            } catch (error) {
              if (editor.document !== original) editor.replaceBlocks(editor.document, original);
              setImportError(
                error instanceof Error && error.message.startsWith("This Markdown file")
                  ? error.message
                  : "The Markdown file could not be imported.",
              );
            } finally {
              input.value = "";
            }
          }}
        />
        <Button variant="outline" size="sm" onClick={exportMarkdown}>
          <Download /> Export .md
        </Button>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          Type / for blocks
        </span>
      </div>
      {importError && <p className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">{importError}</p>}
      <BlockNoteView
        editor={editor}
        theme={ui.theme}
        shadCNComponents={{
          DropdownMenu: {
            ...ShadCNDefaultComponents.DropdownMenu,
            DropdownMenuTrigger: DragSafeDropdownMenuTrigger,
          },
        }}
        onChange={(current) =>
          onDocumentChange(current.document as unknown as NoteBlock[])
        }
        className="min-h-[28rem]"
        data-testid="notes-editor"
      />
      <p className="border-t px-4 py-2 text-xs leading-5 text-muted-foreground">
        Markdown is a portable copy and may simplify tables or rich formatting. The saved note keeps the full block document.
      </p>
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
            <label className="mt-4 block text-xs font-medium" htmlFor="note-link-text">Link text</label>
            <Input id="note-link-text" className="mt-1" value={linkText} onChange={(event) => setLinkText(event.target.value)} />
            <label className="mt-3 block text-xs font-medium" htmlFor="note-link-url">Link URL</label>
            <Input
              id="note-link-url"
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
