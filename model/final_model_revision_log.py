from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REVISION_HISTORY_FILENAME = "revision_history.jsonl"


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _read_manifest(final_models_root: Path) -> dict[str, Any]:
    manifest_path = final_models_root / "manifest.json"
    if not manifest_path.exists():
        return {}
    return json.loads(manifest_path.read_text())


def _compute_manifest_hash(final_models_root: Path) -> str | None:
    manifest_path = final_models_root / "manifest.json"
    if not manifest_path.exists():
        return None
    return _sha256_bytes(manifest_path.read_bytes())


def compute_final_model_source_hash(final_models_root: Path) -> str:
    if not final_models_root.exists():
        return "unknown"

    tracked_files = [
        path
        for path in sorted(final_models_root.rglob("*"))
        if path.is_file() and path.name != REVISION_HISTORY_FILENAME
    ]
    if not tracked_files:
        return "unknown"

    digest = hashlib.sha256()
    for path in tracked_files:
        relative_path = path.relative_to(final_models_root).as_posix()
        file_hash = _sha256_bytes(path.read_bytes())
        digest.update(f"{relative_path}:{file_hash}\n".encode("utf-8"))

    return digest.hexdigest()


def _summarize_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    matrices: dict[str, Any] = {}
    for matrix_name, matrix_config in manifest.items():
        if not isinstance(matrix_config, dict):
            continue

        components: list[dict[str, Any]] = []
        raw_components = matrix_config.get("components")
        if isinstance(raw_components, list):
            for component in raw_components:
                if not isinstance(component, dict):
                    continue
                components.append(
                    {
                        "component": component.get("component"),
                        "weight": component.get("weight"),
                        "modelType": component.get("modelType"),
                        "featureMode": component.get("featureMode"),
                        "sourceExperiment": component.get("sourceExperiment"),
                        "sourceModel": component.get("sourceModel"),
                    }
                )

        matrices[matrix_name] = {
            "weights": matrix_config.get("weights"),
            "sourceExperiment": matrix_config.get("sourceExperiment"),
            "sourceModel": matrix_config.get("sourceModel"),
            "components": components,
        }

    return matrices


def capture_final_model_state(final_models_root: Path) -> dict[str, Any]:
    manifest = _read_manifest(final_models_root)
    return {
        "manifestPath": str((final_models_root / "manifest.json").resolve()),
        "manifestHash": _compute_manifest_hash(final_models_root),
        "modelSourceHash": compute_final_model_source_hash(final_models_root),
        "matrices": _summarize_manifest(manifest),
    }


def append_final_model_revision(
    *,
    final_models_root: Path,
    operation: str,
    previous_state: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    recorded_at = datetime.now(timezone.utc).isoformat()
    current_state = capture_final_model_state(final_models_root)
    baseline_state = previous_state or {
        "manifestHash": None,
        "modelSourceHash": None,
        "matrices": {},
    }

    entry = {
        "revisionId": f"{recorded_at}-{str(current_state['modelSourceHash'])[:12]}",
        "recordedAt": recorded_at,
        "operation": operation,
        "manifestPath": current_state["manifestPath"],
        "previousManifestHash": baseline_state.get("manifestHash"),
        "currentManifestHash": current_state["manifestHash"],
        "previousModelSourceHash": baseline_state.get("modelSourceHash"),
        "currentModelSourceHash": current_state["modelSourceHash"],
        "changed": baseline_state.get("modelSourceHash") != current_state["modelSourceHash"],
        "previousMatrices": baseline_state.get("matrices", {}),
        "currentMatrices": current_state["matrices"],
        "context": context or {},
    }

    final_models_root.mkdir(parents=True, exist_ok=True)
    history_path = final_models_root / REVISION_HISTORY_FILENAME
    with history_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(entry) + "\n")

    return entry
