/**
 * Réglages de la conférence de presse (onglet des paramètres) et carte « annonce » de la fiche joueur :
 * présentateurs (photo → tête 3D sculptée automatiquement, coiffure, voix Fish Audio ou clonage de leur voix),
 * textes, aperçu 3D en direct.
 */
import { AlertTriangle, Camera, Check, Mic, Pause, Play, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../lib/api';
import { preparePhoto } from '../lib/images';
import { useApp } from '../lib/store';
import type { HairStyle, Player, PressSettings } from '../lib/types';
import { Field, Spinner, useAsync, useToast } from './ui';

/* ------------------------------------------------------------------ lecture audio */

let current: HTMLAudioElement | null = null;

/** Joue un MP3 renvoyé par le serveur (voix Fish Audio). */
async function playFrom(req: () => Promise<Response>) {
  const r = await req();
  if (!r.ok) {
    const msg = await r.json().then((j: { error?: string }) => j.error).catch(() => null);
    throw new ApiError(r.status, msg || 'Voix indisponible');
  }
  const url = URL.createObjectURL(await r.blob());
  current?.pause();
  current = new Audio(url);
  current.onended = () => URL.revokeObjectURL(url);
  await current.play();
}

/* ------------------------------------------------------------------ enregistreur */

const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

function blobToDataUrl(b: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Lecture impossible'));
    r.readAsDataURL(b);
  });
}

/** Enregistrer au micro (ou importer un fichier), réécouter, supprimer. */
export function Recorder({ url, onSave, onDelete, maxSec = 30, label, disabled }: { url: string | null; onSave: (dataUrl: string) => Promise<void>; onDelete: () => Promise<void>; maxSec?: number; label: string; disabled?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [secs, setSecs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const save = async (blob: Blob) => {
    setState('busy');
    try {
      await onSave(await blobToDataUrl(blob));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setState('idle');
    }
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Enregistrement impossible sur cet appareil : importez un fichier audio', true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported?.(m));
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void save(new Blob(chunks, { type: (r.mimeType || mimeType || 'audio/webm').split(';')[0] }));
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState('rec');
    } catch {
      toast('Micro refusé ou indisponible', true);
    }
  };

  useEffect(() => {
    if (state !== 'rec') return;
    const t = setInterval(() => {
      setSecs((s) => {
        if (s + 1 >= maxSec) rec.current?.state === 'recording' && rec.current.stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state, maxSec]);

  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  const play = () => {
    if (!url) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => setPlaying(false);
    void a.play().then(() => setPlaying(true)).catch(() => toast('Lecture impossible sur ce navigateur', true));
  };

  return (
    <div className="press-rec">
      <span className="press-rec-label">{label}</span>
      {state === 'rec' ? (
        <button className="btn sm danger" onClick={stop}>
          <Square fill="currentColor" /> Arrêter · {secs}s
        </button>
      ) : (
        <button className="btn sm" onClick={start} disabled={disabled || state === 'busy'}>
          {state === 'busy' ? <Spinner /> : <Mic />} {url ? 'Réenregistrer' : 'Enregistrer'}
        </button>
      )}
      {url && state !== 'rec' && (
        <>
          <button className="btn sm icon ghost" onClick={play} aria-label={playing ? 'Pause' : 'Écouter'}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button className="btn sm icon ghost" disabled={disabled} onClick={() => void onDelete().catch((e) => toast((e as Error).message, true))} aria-label="Supprimer l’enregistrement">
            <Trash2 />
          </button>
        </>
      )}
      {!url && state === 'idle' && (
        <>
          <button className="btn sm icon ghost" disabled={disabled} onClick={() => file.current?.click()} aria-label="Importer un fichier audio" title="Importer un fichier audio">
            <Upload />
          </button>
          <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => (e.target.files?.[0] && void save(e.target.files[0]), (e.target.value = ''))} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ aperçu 3D */

type Presenter = PressSettings['presenters'][number];
type View = 'room' | number;

interface PreviewScene {
  setTalk: (v: number) => void;
  dispose: () => void;
  setSpeaker: (i: number) => void;
  cue: (c: 'orbit' | 'portrait') => void;
}

/** La salle de presse en direct avec les réglages en cours : vue d'ensemble ou gros plan sur un présentateur (qui parle). */
function Preview3D({ presenters, group, club, logo, color, view }: { presenters: Presenter[]; group: string; club: string; logo: string | null; color: string; view: View }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<PreviewScene | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(true);
  const key = JSON.stringify(presenters.map((p) => [p.name, p.role, p.photoUrl, p.style, p.hair, p.cap, p.number]));
  const apply = (s: PreviewScene) => {
    if (view === 'room') s.cue('orbit');
    else {
      s.setSpeaker(view);
      s.cue('portrait');
    }
  };
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      void Promise.all([import('../press/scene'), import('../press/textures')])
        .then(async ([{ PressScene }, { clubLook }]) =>
          PressScene.create(ref.current!, {
            presenters: presenters.map((p) => ({ name: p.name, role: p.role, photo: p.photoUrl, landmarks: p.landmarks, style: p.style, hair: p.hair, cap: p.cap, number: p.number })),
            speaker: 0,
            logo,
            club,
            color: (await clubLook(logo, color)).color,
            group,
            line: 'Aperçu',
          }),
        )
        .then((s) => {
          if (!alive) return s.dispose();
          scene.current?.dispose();
          scene.current = s;
          apply(s);
          setBusy(false);
        })
        .catch(() => alive && setErr(true));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // Reconstruit la scène quand un réglage visible change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, logo, club, color, group]);
  useEffect(() => () => scene.current?.dispose(), []);
  useEffect(() => {
    if (scene.current) apply(scene.current);
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // En gros plan, la bouche s'anime comme s'il parlait (pour juger le rendu).
      const s = t / 1000;
      scene.current?.setTalk(view === 'room' ? 0 : Math.max(0, Math.sin(s * 11) * 0.5 + Math.sin(s * 4.3) * 0.4) * (Math.sin(s * 0.7) > -0.3 ? 1 : 0));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  if (err) return <p className="small muted">Aperçu 3D indisponible sur cet appareil.</p>;
  return (
    <div className="press-preview-wrap">
      <canvas ref={ref} className="press-preview" />
      {busy && (
        <span className="press-preview-busy">
          <Spinner /> Sculpture des têtes…
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ réglages */

const STYLES: { value: HairStyle; label: string }[] = [
  { value: 'cap', label: 'Casquette' },
  { value: 'fringe', label: 'Frange' },
  { value: 'short', label: 'Court' },
  { value: 'curly', label: 'Bouclé' },
  { value: 'long', label: 'Long' },
  { value: 'bald', label: 'Sans cheveux' },
];

/** Phrase lue pour l'échantillon de voix (sa transcription aide Fish Audio à cloner la voix). */
const SAMPLE_TEXT =
  'Bonjour à tous et merci d’être venus. Je suis très fier de ce groupe : les enfants ont énormément travaillé cette semaine à l’entraînement. Samedi, on joue pour gagner, mais surtout pour prendre du plaisir ensemble. Allez, place au jeu !';

function groupsFromTeams(categories: string[]) {
  const all = categories.flatMap((c) => (c.match(/U\s?\d{1,2}/gi) || []).map((g) => g.replace(/\s/g, '').toUpperCase()));
  return [...new Set(all)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function PressSettingsPanel() {
  const { me, can } = useApp();
  const toast = useToast();
  const q = useAsync(() => api.get<PressSettings>('/press/settings'), []);
  const [draft, setDraft] = useState<PressSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('room');
  const [faceBusy, setFaceBusy] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const canEdit = can('convocations.manage');
  const groups = useMemo(() => groupsFromTeams(me.teams.map((t) => t.category)), [me.teams]);
  const color = me.teams[0]?.color || '#c8102e';

  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data);
  }, [q.data, dirty]);

  if (!draft) return <Spinner />;

  const set = (patch: Partial<PressSettings>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const setP = (i: number, patch: Partial<Presenter>) => set({ presenters: draft.presenters.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  const save = async () => {
    setBusy(true);
    try {
      const out = await api.put<PressSettings>('/press/settings', draft);
      setDraft(out);
      setDirty(false);
      q.setData(out);
      toast('Conférence de presse enregistrée');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  /** Photo, échantillon de voix : envoyés tout de suite, en gardant les autres modifications en cours. */
  const media = async (fn: () => Promise<PressSettings>) => {
    const out = await fn();
    q.setData(out);
    setDraft((d) =>
      d
        ? {
            ...d,
            presenters: d.presenters.map((p) => {
              const o = out.presenters.find((x) => x.id === p.id);
              return o ? { ...p, photo: o.photo, photoUrl: o.photoUrl, landmarks: o.landmarks, sampleUrl: o.sampleUrl, voice: { ...p.voice, sample: o.voice.sample, transcript: o.voice.transcript } } : p;
            }),
          }
        : d,
    );
  };

  /** Photo envoyée : le visage est détecté dans le navigateur, puis la tête 3D en est sculptée. */
  const uploadPhoto = async (i: number, f?: File) => {
    if (!f) return;
    const p = draft.presenters[i];
    setFaceBusy(i);
    try {
      const img = await preparePhoto(f);
      const el = new Image();
      await new Promise((ok, fail) => {
        el.onload = ok;
        el.onerror = () => fail(new Error('Photo illisible'));
        el.src = img.image;
      });
      const { detectFace } = await import('../press/faceDetect');
      const landmarks = await detectFace(el).catch(() => null);
      await media(() => api.post<PressSettings>(`/press/presenters/${p.id}/photo`, { image: img.image, landmarks }));
      setView(i);
      toast(landmarks ? 'Visage détecté : tête 3D générée' : 'Aucun visage détecté : choisissez une photo de face, bien éclairée', !landmarks);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setFaceBusy(null);
    }
  };

  const testVoice = async (i: number) => {
    const p = draft.presenters[i];
    setTesting(i);
    try {
      await playFrom(() =>
        fetch(`/api/press/presenters/${p.id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: p.voice.id, group: p.groups[0] }), credentials: 'same-origin' }),
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setTesting(null);
    }
  };

  const addPresenter = () =>
    set({
      presenters: [
        ...draft.presenters,
        {
          id: '', name: 'Coach', role: '', groups: [], photo: null, photoUrl: null, landmarks: null, style: 'short', hair: 'auto', cap: 'auto', number: null,
          voice: { id: draft.voices[draft.presenters.length % draft.voices.length]?.id ?? '', sample: null, transcript: '' }, sampleUrl: null,
        },
      ],
    });

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 1040 }}>
      <div className="card pad stack">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="press-cta-ic" style={{ background: 'var(--surface-2)' }}>🎙️</span>
          <div className="grow">
            <b>Conférence de presse</b>
            <p className="small muted">
              À la publication d’une convocation, les familles reçoivent une cinématique : les présentateurs annoncent la sélection derrière leur micro, puis chaque joueur convoqué apparaît avec sa photo pendant que son prénom est prononcé.
            </p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={draft.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} />
            <i />
          </label>
        </div>
        {!draft.tts && (
          <p className="press-warn">
            <AlertTriangle size={16} />
            <span>
              Voix Fish Audio non configurées : ajoutez <code>OPENROUTER_API_KEY=…</code> dans le fichier <code>.env</code> du serveur, puis redémarrez-le. En attendant, la cinématique
              s’affiche avec les sous-titres seuls.
            </span>
          </p>
        )}
      </div>

      <div className="press-grid">
        {draft.presenters.map((p, i) => (
          <div key={p.id || i} className="card pad stack press-presenter">
            <div className="row" style={{ gap: 10 }}>
              <span className="press-face" style={p.photoUrl ? { backgroundImage: `url(${p.photoUrl})` } : undefined}>
                {!p.photoUrl && <Camera size={18} />}
              </span>
              <div className="grow">
                <b>{p.name || 'Présentateur'}</b>
                <div className="small muted">{i === 0 ? 'Siège de gauche' : 'Siège de droite'} · annonce {p.groups.join(', ') || 'toutes les catégories'}</div>
              </div>
              {canEdit && draft.presenters.length > 1 && (
                <button className="btn icon ghost sm" onClick={() => set({ presenters: draft.presenters.filter((_, k) => k !== i) })} aria-label="Retirer ce présentateur">
                  <Trash2 />
                </button>
              )}
            </div>

            <div className="row wrap" style={{ gap: 10 }}>
              <Field label="Prénom">
                <input className="input" value={p.name} disabled={!canEdit} onChange={(e) => setP(i, { name: e.target.value })} />
              </Field>
              <Field label="Rôle (chevalet)">
                <input className="input" value={p.role} disabled={!canEdit} placeholder="Coach U8" onChange={(e) => setP(i, { role: e.target.value })} />
              </Field>
            </div>

            <Field label="Annonce les convocations des">
              <div className="row wrap" style={{ gap: 6 }}>
                {(groups.length ? groups : ['U8', 'U9']).map((g) => (
                  <button
                    key={g}
                    className={`chip${p.groups.includes(g) ? ' on' : ''}`}
                    disabled={!canEdit}
                    onClick={() => setP(i, { groups: p.groups.includes(g) ? p.groups.filter((x) => x !== g) : [...p.groups, g] })}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Tête 3D" hint="sculptée d’après la photo">
              <div className="press-face-status">
                {faceBusy === i ? (
                  <>
                    <Spinner /> Détection du visage…
                  </>
                ) : p.landmarks ? (
                  <>
                    <Check size={15} className="ok" /> Visage détecté sur la photo
                  </>
                ) : p.photoUrl ? (
                  <>
                    <AlertTriangle size={15} /> Aucun visage détecté : photo de face, bien éclairée
                  </>
                ) : (
                  <span className="muted">Sans photo, une tête générique est utilisée.</span>
                )}
              </div>
              {canEdit && p.id && (
                <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                  <label className="btn sm">
                    <Camera /> {p.photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
                    <input type="file" accept="image/*" hidden onChange={(e) => (void uploadPhoto(i, e.target.files?.[0]), (e.target.value = ''))} />
                  </label>
                  {p.photoUrl && (
                    <button className="btn sm ghost" onClick={() => void media(() => api.del<PressSettings>(`/press/presenters/${p.id}/photo`))}>
                      Retirer
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => setView(i)}>
                    Voir en gros plan
                  </button>
                </div>
              )}
              {canEdit && !p.id && <p className="small muted">Enregistrez pour ajouter la photo.</p>}
            </Field>

            <div className="row wrap" style={{ gap: 10 }}>
              <Field label="Coiffure">
                <select className="input" value={p.style} disabled={!canEdit} onChange={(e) => setP(i, { style: e.target.value as HairStyle })}>
                  {STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <ColorAuto label="Cheveux" value={p.hair} disabled={!canEdit} onChange={(hair) => setP(i, { hair })} />
              {p.style === 'cap' && <ColorAuto label="Casquette" value={p.cap} disabled={!canEdit} onChange={(cap) => setP(i, { cap })} />}
              <Field label="N° maillot">
                <input className="input" style={{ width: 80 }} inputMode="numeric" value={p.number ?? ''} disabled={!canEdit} onChange={(e) => setP(i, { number: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) || 0 })} />
              </Field>
            </div>

            <Field label="Voix Fish Audio" hint={p.voice.sample ? 'remplacée par sa voix clonée' : 'bibliothèque ou lien fish.audio'}>
              <select
                className="input"
                value={draft.voices.some((v) => v.id === p.voice.id) ? p.voice.id : 'custom'}
                disabled={!canEdit || !!p.voice.sample}
                onChange={(e) => setP(i, { voice: { ...p.voice, id: e.target.value === 'custom' ? '' : e.target.value } })}
              >
                {draft.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
                <option value="custom">Autre voix (lien fish.audio)…</option>
              </select>
              {!draft.voices.some((v) => v.id === p.voice.id) && !p.voice.sample && (
                <input
                  className="input"
                  style={{ marginTop: 6 }}
                  placeholder="https://fish.audio/m/…"
                  value={p.voice.id}
                  disabled={!canEdit}
                  onChange={(e) => setP(i, { voice: { ...p.voice, id: (/[0-9a-f]{32}/i.exec(e.target.value)?.[0] ?? e.target.value).toLowerCase() } })}
                />
              )}
              <button className="btn sm" style={{ marginTop: 8, alignSelf: 'flex-start' }} disabled={testing !== null || !p.id} onClick={() => void testVoice(i)}>
                {testing === i ? <Spinner /> : <Volume2 />} {testing === i ? 'Génération de la voix…' : 'Écouter l’annonce'}
              </button>
            </Field>

            {p.id && (
              <Field label="Cloner sa voix" hint="facultatif · 15 à 30 s">
                <div className="stack" style={{ gap: 6 }}>
                  <p className="small press-read">Lisez à voix haute : « {SAMPLE_TEXT} »</p>
                  <Recorder
                    label={p.voice.sample ? 'Voix clonée ✓' : 'Échantillon'}
                    url={p.sampleUrl}
                    disabled={!canEdit}
                    maxSec={35}
                    onSave={(audio) => media(() => api.post<PressSettings>(`/press/presenters/${p.id}/sample`, { audio, transcript: SAMPLE_TEXT }))}
                    onDelete={() => media(() => api.del<PressSettings>(`/press/presenters/${p.id}/sample`))}
                  />
                </div>
              </Field>
            )}
          </div>
        ))}
        {canEdit && draft.presenters.length < 2 && (
          <button className="card pad press-add" onClick={addPresenter}>
            + Ajouter un présentateur
          </button>
        )}
      </div>

      <div className="card pad stack">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
          <b>Aperçu</b>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip${view === 'room' ? ' on' : ''}`} onClick={() => setView('room')}>
              La salle
            </button>
            {draft.presenters.map((p, i) => (
              <button key={i} className={`chip${view === i ? ' on' : ''}`} onClick={() => setView(i)}>
                {p.name} en gros plan
              </button>
            ))}
          </div>
        </div>
        <Preview3D presenters={draft.presenters} group={groups[0] ?? 'U8'} club={me.club?.name ?? ''} logo={me.club?.logo ?? null} color={color} view={view} />
        {!me.club?.logo && <p className="small muted">Ajoutez le logo du club (onglet Club) : il habille le mur, la table, les maillots et la casquette.</p>}
      </div>

      <div className="card pad stack">
        <Field label="Annonce" hint="{groupe}, {adversaire}, {rendezvous}, {lieu}, {club}, {match}">
          <textarea className="textarea" rows={2} value={draft.intro} disabled={!canEdit} onChange={(e) => set({ intro: e.target.value })} />
        </Field>
        <Field label="Conclusion" hint="après la liste, facultatif">
          <textarea className="textarea" rows={2} value={draft.outro} disabled={!canEdit} onChange={(e) => set({ outro: e.target.value })} />
        </Field>
        <Field label={`Temps par joueur : ${String(draft.hold).replace('.', ',')} s`}>
          <input type="range" min={1.5} max={6} step={0.5} value={draft.hold} disabled={!canEdit} onChange={(e) => set({ hold: Number(e.target.value) })} />
        </Field>
      </div>

      {canEdit && (
        <div className="press-save">
          <button className="btn primary lg" disabled={!dirty || busy} onClick={save}>
            {busy ? <Spinner /> : null} {dirty ? 'Enregistrer les réglages' : 'Réglages enregistrés'}
          </button>
        </div>
      )}
    </div>
  );
}

function ColorAuto({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const auto = value === 'auto' || !value;
  return (
    <Field label={label}>
      <div className="row" style={{ gap: 6 }}>
        <input type="color" className="press-color" value={auto ? '#6b4a33' : value} disabled={disabled || auto} onChange={(e) => onChange(e.target.value)} />
        <button className={`chip${auto ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(auto ? '#6b4a33' : 'auto')} title="Couleur prélevée sur la photo">
          Auto
        </button>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ fiche joueur */

/** Carte de la fiche joueur : comment son prénom sera annoncé (prononciation, écoute avec la voix du coach). */
export function PressPlayerCard({ player, canEdit, onChange }: { player: Player; canEdit: boolean; onChange: (p: Player) => void }) {
  const toast = useToast();
  const [say, setSay] = useState(player.press?.say ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setSay(player.press?.say ?? ''), [player.press?.say]);
  const photo = player.photo ? `/api/players/${player.id}/photo?v=${player.photo}` : null;
  const saveSay = async () => {
    if ((player.press?.say ?? '') === say.trim()) return;
    try {
      onChange(await api.put<Player>(`/players/${player.id}/press`, { say }));
      toast('Prononciation enregistrée');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const listen = async () => {
    setBusy(true);
    try {
      await playFrom(() => fetch(`/api/players/${player.id}/say?say=${encodeURIComponent(say.trim())}`, { credentials: 'same-origin' }));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad press-player">
      <span className="pc-portrait press-player-photo" style={{ ['--team' as string]: '#c8102e' } as CSSProperties}>
        {photo ? <img src={photo} alt="" /> : <b>{player.firstName.slice(0, 1)}</b>}
      </span>
      <div className="grow stack" style={{ gap: 6 }}>
        <div>
          <b>🎙️ Annonce en conférence de presse</b>
          <div className="small muted">Convoqué, {player.firstName} apparaît avec cette photo pendant que le coach annonce son prénom.</div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            value={say}
            disabled={!canEdit}
            placeholder={`Prononciation : ${player.firstName}`}
            onChange={(e) => setSay(e.target.value)}
            onBlur={saveSay}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          <button className="btn sm" disabled={busy} onClick={() => void listen()}>
            {busy ? <Spinner /> : <Volume2 />} Écouter
          </button>
        </div>
      </div>
    </div>
  );
}
