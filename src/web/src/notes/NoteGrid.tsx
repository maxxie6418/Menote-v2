import { ArrowRight, Lock } from "lucide-react";
import type { DemoNote } from "../lib/demoData";
import { demoEmptyState } from "../lib/demoData";

interface NoteGridProps {
  notes: DemoNote[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}

export function NoteGrid({ notes, selectedNoteId, onSelectNote }: NoteGridProps) {
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
    <div className="mn-gcards">
      {notes.map((note) => (
        <div
          key={note.id}
          role="button"
          tabIndex={0}
          className={`mn-gcard${selectedNoteId === note.id ? " on" : ""}`}
          onClick={() => onSelectNote(note.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectNote(note.id);
            }
          }}
          aria-pressed={selectedNoteId === note.id}
        >
          <span className="mn-gc-t">
            {note.title}
            {note.kind === "locked" && <Lock />}
          </span>
          <span className="mn-gc-d">{note.summary}</span>
          <span className="mn-gc-m">
            <span>{note.time}</span>
            <ArrowRight />
          </span>
        </div>
      ))}
    </div>
  );
}
