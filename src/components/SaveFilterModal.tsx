import { useState } from "react";
import type { DomainFilter } from "../../shared/filters";
import { errorText } from "../lib/api";
import { useSaveFilter } from "../lib/queries";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { Button } from "./ui";

export function SaveFilterModal({ open, onClose, filter }: { open: boolean; onClose: () => void; filter: DomainFilter }) {
  const [name, setName] = useState("");
  const save = useSaveFilter();
  const toast = useToast();
  const submit = async () => {
    try {
      await save.mutateAsync({ name: name.trim(), configuration: filter });
      toast(`Saved filter “${name.trim()}”`, "success");
      setName("");
      onClose();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save current filter"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <label>
        <span className="label">Name</span>
        <input className="input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Short Domains" />
      </label>
      <pre className="mt-3 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(filter, null, 2)}</pre>
    </Modal>
  );
}
