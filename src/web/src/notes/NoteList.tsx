import { FileText, Lock, Table2 } from "lucide-react";
import type { DemoNote, DemoNoteKind } from "../lib/demoData";
import { demoEmptyState, demoNoteGroups } from "../lib/demoData";

const kindIcon = { note: FileText, locked: Lock, table: Table2 } as const;
const kindLabel = { note: "笔记", locked: "加密笔记", table: "表格" };

interface NoteListProps {
  notes: DemoNote[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}

export function NoteList({ notes, selectedNoteId, onSelectNote }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="mn-empty" role="status">
        <div>
          <p className="mn-empty-title">{demoEmptyState.listHint}</p>
          <p className="mn-empty-detail">{demoEmptyState.listDetail}</p>
          <p className="mn-empty-key">⌘ N</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mn-rows">
      {demoNoteGroups.map((group) => {
        const items = notes.filter((note) => note.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <div className="mn-grp">{group}</div>
            {items.map((note) => (
              <NoteRow key={note.id} note={note} selected={selectedNoteId === note.id} onSelectNote={onSelectNote} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function NoteRow({ note, selected, onSelectNote }: { note: DemoNote; selected: boolean; onSelectNote: (noteId: string) => void }) {
  const Icon = kindIcon[note.kind];
  return (
    <div
      role="button"
      tabIndex={0}
      className={`mn-nrow${selected ? " on" : ""}`}
      onClick={() => onSelectNote(note.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNote(note.id);
        }
      }}
      aria-pressed={selected}
    >
      <span className="mn-nc-ic" title={kindLabel[note.kind as DemoNoteKind]}>
        <Icon />
      </span>
      <span className="mn-nr-t">{note.title}</span>
      <span className="mn-nr-m">{note.time}</span>
      <span className="mn-nr-d">{note.summary}</span>
    </div>
  );
}
