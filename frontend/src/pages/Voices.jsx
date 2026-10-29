import { useState } from "react";
import CreateVoiceTab from "../components/CreateVoiceTab";
import MyVoicesTab from "../components/MyVoicesTab";
import { useEngines } from "../useEngines";

const TABS = { mine: "My voices", create: "Create a voice" };

export default function Voices() {
  const [tab, setTab] = useState("mine");
  // An OpenAI voice being edited on the Create tab, or null.
  const [editing, setEditing] = useState(null);
  const engines = useEngines();

  function showTab(id) {
    setEditing(null);
    setTab(id);
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Voices</h1>

      <div className="mt-4 flex gap-4 border-b border-gray-200">
        {Object.entries(TABS).map(([id, label]) => (
          <button
            key={id}
            onClick={() => showTab(id)}
            className={`-mb-px border-b-2 pb-2 text-sm ${
              tab === id
                ? "border-black font-medium"
                : "border-transparent text-gray-500 hover:text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {/* My voices reloads each time it's shown, so voices saved on the
            Create tab appear. */}
        {tab === "mine" ? (
          <MyVoicesTab
            onCreate={() => showTab("create")}
            onEdit={(voice) => {
              setEditing(voice);
              setTab("create");
            }}
          />
        ) : (
          <CreateVoiceTab
            engines={engines}
            editing={editing}
            onDoneEditing={() => showTab("mine")}
          />
        )}
      </div>
    </div>
  );
}
