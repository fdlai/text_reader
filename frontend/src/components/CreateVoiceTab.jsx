import { useState } from "react";
import OpenAIVoiceForm from "./OpenAIVoiceForm";
import QwenVoiceForm from "./QwenVoiceForm";

const ENGINES = [
  { id: "qwen", label: "Qwen", note: "free, runs on your GPU" },
  { id: "openai", label: "OpenAI", note: "paid" },
];

// Making a voice with either engine. Both work the same way: describe it,
// preview it, then name and save it.
// editing: an OpenAI voice from My voices to change, or null.
// onDoneEditing: called after saving or cancelling that edit.
export default function CreateVoiceTab({ engines, editing, onDoneEditing }) {
  const [engine, setEngine] = useState("qwen");

  if (editing) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Edit "{editing.name}"</h2>
        <OpenAIVoiceForm
          key={editing.id}
          engines={engines}
          editing={editing}
          onDone={onDoneEditing}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {ENGINES.map((e) => (
          <button
            key={e.id}
            onClick={() => setEngine(e.id)}
            className={`rounded-lg border px-4 py-2 text-left ${
              engine === e.id
                ? "border-black"
                : "border-gray-300 text-gray-500 hover:border-gray-500"
            }`}
          >
            <span className="block font-medium">{e.label}</span>
            <span className="block text-xs">{e.note}</span>
          </button>
        ))}
      </div>
      {engine === "qwen" ? (
        <QwenVoiceForm engines={engines} />
      ) : (
        <OpenAIVoiceForm engines={engines} editing={null} />
      )}
    </div>
  );
}
