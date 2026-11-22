import { ModeId } from './data/modes';
import { MapEditorController } from './editor/MapEditorController';
import { CustomMapDocument, CustomMapLaunchConfig, EditorTestSnapshot } from './editor/types';
import { MatchController } from './game/match';
import { SndMatchController } from './game/sndMatch';
import { MpMatchStartPayload } from './net/protocol';
import { DesktopHub, FragTab } from './ui/desktop';

const app = document.getElementById('app')!;
let activeHub: DesktopHub | null = null;
let activeEditor: MapEditorController | null = null;
let activeMatch: MatchController | SndMatchController | null = null;
let pendingEditorSnapshot: EditorTestSnapshot | null = null;

function disposeAll(): void {
  if (activeMatch) {
    activeMatch.dispose();
    activeMatch = null;
  }
  if (activeEditor) {
    activeEditor.dispose();
    activeEditor = null;
  }
  if (activeHub) {
    activeHub.dispose();
    activeHub = null;
  }
}

function showHub(openFriends = false, initialTab: FragTab = 'play'): void {
  disposeAll();
  activeHub = new DesktopHub(
    app,
    (modeId: ModeId, mpSession?: MpMatchStartPayload) => launchMatch(modeId, mpSession),
    openFriends,
    (doc, autosave) => openEditor(doc, undefined, autosave),
    (cfg) => launchCustomMatch(cfg),
    initialTab,
  );
}

function openEditor(
  doc: CustomMapDocument,
  restoreSnapshot?: EditorTestSnapshot,
  autosave?: { savedAt: string; doc: CustomMapDocument } | null,
): void {
  disposeAll();
  pendingEditorSnapshot = null;
  activeEditor = new MapEditorController(
    app,
    doc,
    () => showHub(false, 'custom_maps'),
    (snapshot, launchConfig) => {
      pendingEditorSnapshot = snapshot;
      launchCustomMatch(launchConfig);
    },
    restoreSnapshot,
    autosave,
  );
}

function launchMatch(modeId: ModeId, mpSession?: MpMatchStartPayload): void {
  disposeAll();
  activeMatch = modeId === 'snd' && !mpSession
    ? new SndMatchController(app, () => showHub())
    : new MatchController(app, modeId, () => showHub(Boolean(mpSession)), mpSession);
}

function launchCustomMatch(cfg: CustomMapLaunchConfig): void {
  disposeAll();
  const returnCb = () => {
    if (cfg.isTestPlay && pendingEditorSnapshot) {
      const snap = pendingEditorSnapshot;
      pendingEditorSnapshot = null;
      openEditor(snap.document, snap, null);
    } else {
      pendingEditorSnapshot = null;
      showHub(false, 'custom_maps');
    }
  };
  activeMatch = cfg.modeId === 'snd'
    ? new SndMatchController(app, returnCb, cfg)
    : new MatchController(app, cfg.modeId, returnCb, undefined, cfg);
}

showHub();
