import { ArrowLeft, ClipboardList, Link2, Play, RotateCcw, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FutCard } from '../components/FutCard';
import { Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { MONTHS_LONG, fromYMD } from '../lib/events';
import { PressAudio } from '../press/audio';
import { LightningFx, type Portal } from '../press/lightning';
import { PressScene } from '../press/scene';
import { clubLook } from '../press/textures';
import type { PressData, PressPlayer } from '../lib/types';

/** Conférence de presse d'un match, dans l'app (éducateur : aperçu ; parent : après publication). */
export function PressPage() {
  const { eventId, date } = useParams();
  const nav = useNavigate();
  const q = useAsync(() => api.get<PressData>(`/convocations/${eventId}/${date}/press`), [eventId, date]);
  const back = () => nav(`/matchs/${eventId}/${date}`);
  if (q.loading && !q.data) return <PressLoading />;
  if (!q.data) return <PressError text={q.error} onBack={back} />;
  return (
    <PressShow
      data={q.data}
      onClose={back}
      onStart={() => void api.post(`/convocations/${eventId}/${date}/read`).catch(() => undefined)}
    />
  );
}

/** Conférence de presse via le lien partagé (sans compte). */
export function PublicPress() {
  const { token } = useParams();
  const q = useAsync(() => api.get<PressData>(`/public/press/${token}`), [token]);
  if (q.loading && !q.data) return <PressLoading />;
  if (!q.data) return <PressError text={q.error} />;
  return <PressShow data={q.data} />;
}

function PressLoading() {
  return (
    <div className="pc">
      <div className="pc-poster">
        <Spinner />
      </div>
    </div>
  );
}

function PressError({ text, onBack }: { text: string | null; onBack?: () => void }) {
  return (
    <div className="pc">
      <div className="pc-poster">
        <h2 className="pc-poster-title">Conférence indisponible</h2>
        <p style={{ opacity: 0.75 }}>{text}</p>
        {onBack && (
          <button className="btn lg" onClick={onBack}>
            Retour
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ textes */

const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function dayWords(ymd: string) {
  const d = fromYMD(ymd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff > 1 && diff < 7) return WD[d.getDay()];
  return `${WD[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** « 09:30 » → « 9h30 », « 09:00 » → « 9h ». */
const hour = (t: string) => {
  const [h, m] = t.split(':');
  return `${Number(h)}h${m && m !== '00' ? m : ''}`;
};

/** Titre de l'écran final : « Samedi à 9h30 ». */
function whenTitle(ymd: string, time: string) {
  const day = WD[fromYMD(ymd).getDay()];
  const d = day.charAt(0).toUpperCase() + day.slice(1);
  return time ? `${d} à ${hour(time)}` : d;
}

/* ------------------------------------------------------------------ éléments visuels */

function Confetti({ count = 70, colors }: { count?: number; colors: string[] }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.6 + Math.random() * 1.6,
        rot: Math.random() * 720 - 360,
        x: Math.random() * 160 - 80,
        color: colors[i % colors.length],
        w: 6 + Math.random() * 6,
      })),
    [count, colors],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i
          key={i}
          style={{ left: `${b.left}%`, background: b.color, width: b.w, height: b.w * 1.6, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, ['--rot' as string]: `${b.rot}deg`, ['--x' as string]: `${b.x}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** Sous-titres : les mots déjà prononcés s'allument. */
function Caption({ text, upTo }: { text: string; upTo: number }) {
  const words = [...text.matchAll(/\S+/g)];
  return (
    <p className="pc-caption">
      {words.map((w, i) => (
        <span key={i} className={(w.index ?? 0) <= upTo ? 'on' : ''}>
          {w[0]}{' '}
        </span>
      ))}
    </p>
  );
}

/** Brèche de l'éclair : centrée un peu au-dessus du milieu, en ovale vertical (photo en pied). */
function portalFor(w: number, h: number): Portal {
  const rx = Math.min(w * 0.36, h * 0.27, 300);
  return { x: w / 2, y: h * 0.47, rx, ry: Math.min(h * 0.39, rx * 1.45) };
}

function usePortal() {
  const [p, setP] = useState(() => portalFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = () => setP(portalFor(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return p;
}

/** Mélange de deux couleurs hexadécimales. */
function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Éclair façon Duolingo : il tombe au centre, s'y écrase et ouvre un cercle ;
 * le contenu (photo en pied, prénom) apparaît dans le cercle au moment de l'impact.
 */
function LightningReveal({ glow, onMeet, children, className }: { glow: string; onMeet?: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fx = useRef<LightningFx | null>(null);
  const portal = usePortal();
  const [met, setMet] = useState(false);
  const meet = useRef(onMeet);
  meet.current = onMeet;
  useLayoutEffect(() => {
    if (!ref.current) return;
    const f = new LightningFx(ref.current, { color: glow, portal });
    f.onMeet = () => {
      setMet(true);
      meet.current?.();
    };
    fx.current = f;
    return () => f.dispose();
    // Un éclair par apparition (le composant est recréé à chaque joueur).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    fx.current?.resize();
    fx.current?.setPortal(portal);
  }, [portal]);
  return (
    <div className={`pc-bolt${met ? ' met' : ''}${className ? ` ${className}` : ''}`} style={{ ['--px' as string]: `${portal.x}px`, ['--py' as string]: `${portal.y}px`, ['--rx' as string]: `${portal.rx}px`, ['--ry' as string]: `${portal.ry}px` } as CSSProperties}>
      <canvas ref={ref} className="pc-bolt-canvas" aria-hidden />
      <div className="pc-rift">{met && children}</div>
    </div>
  );
}

/** Contenu de la brèche : la photo en pied (ou le portrait), le prénom par-dessus, le numéro. */
function PlayerInRift({ p }: { p: PressPlayer }) {
  return (
    <div className={`pc-rift-player${p.photo ? '' : ' nophoto'}${p.full ? ' full' : ''}`}>
      {p.photo && <img className="pc-rift-photo" src={p.photo} alt="" draggable={false} />}
      <h1 className="pc-rift-name" style={{ ['--len' as string]: Math.max(4, p.firstName.length) } as CSSProperties}>
        {p.firstName.toUpperCase()}
      </h1>
      {p.number != null && <span className="pc-rift-num">{p.number}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ cinématique */

type Phase = 'poster' | 'intro' | 'speech' | 'eclair' | 'player' | 'final';

class Cancelled extends Error {}

export function PressShow({ data, onClose, onStart }: { data: PressData; onClose?: () => void; onStart?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PressScene | null>(null);
  const audioRef = useRef<PressAudio | null>(null);
  const runRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [no3d, setNo3d] = useState(false);
  const [phase, setPhase] = useState<Phase>('poster');
  const [idx, setIdx] = useState(0);
  const [caption, setCaption] = useState<{ text: string; upTo: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(0);
  // Voix préparées pendant l'affiche (le son se décode avant même le premier geste).
  const voiceUrls = [data.speech.intro.url, ...data.players.map((p) => p.voice), data.speech.outro?.url].filter(Boolean) as string[];
  const [voices, setVoices] = useState({ done: 0, ok: 0 });
  const [voiceWait, setVoiceWait] = useState(true);

  // Couleurs du club : la teinte dominante du logo (sinon la couleur de l'équipe), logo détouré pour l'habillage.
  const [look, setLook] = useState<{ color: string; logo: string | null; clean: boolean } | null>(null);
  const color = look?.color ?? data.team.color ?? '#c8102e';
  const logo = look?.logo ?? data.club.logo;
  const speaker = data.presenters[data.speaker] ?? null;
  const matchLine = [data.opponent ? `${data.title}` : data.title, dayWords(data.date)].filter(Boolean).join(' · ');
  const hasMine = data.players.some((p) => p.mine);
  // Lueur des éclairs : bleu électrique teinté de la couleur du club.
  const glow = mixHex(color.startsWith('#') ? color : '#c8102e', '#8fd6ff', 0.55);

  useEffect(() => {
    let alive = true;
    void clubLook(data.club.logo, data.team.color || '#c8102e').then((l) => alive && setLook(l));
    return () => {
      alive = false;
    };
  }, [data.club.logo, data.team.color]);

  // Scène 3D construite pendant l'affiche (plan d'ensemble en fond).
  useEffect(() => {
    let alive = true;
    const el = canvasRef.current;
    if (!el || !look) return;
    const quality = (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';
    PressScene.create(el, {
      presenters: data.presenters.map((p) => ({ name: p.name, role: p.role, style: p.style, hair: p.hair, cap: p.cap })),
      speaker: data.speaker,
      logo: data.club.logo,
      club: data.club.name,
      color,
      group: data.group,
      line: matchLine,
      quality,
    })
      .then((s) => {
        if (!alive) return s.dispose();
        sceneRef.current = s;
        if (import.meta.env.DEV) (window as unknown as { __press: PressScene }).__press = s;
        s.cue('orbit');
        s.onFlash = () => audioRef.current?.shutter(0.12 + Math.random() * 0.2);
        setReady(true);
      })
      .catch((e) => {
        console.warn('Conférence de presse : 3D indisponible', e);
        if (alive) {
          setNo3d(true);
          setReady(true);
        }
      });
    return () => {
      alive = false;
      runRef.current++;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      audioRef.current?.close();
      audioRef.current = null;
    };
    // La scène ne dépend que des données du match et des couleurs du club.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, look]);

  // Bouche de l'orateur au rythme de la voix.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = audioRef.current;
      sceneRef.current?.setTalk(a ? a.level() : 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Contexte audio créé tout de suite (suspendu jusqu'au geste) : les voix se téléchargent et se décodent pendant l'affiche.
  useEffect(() => {
    let a: PressAudio | null = null;
    try {
      a = new PressAudio();
    } catch {
      setVoiceWait(false);
      return;
    }
    audioRef.current = a;
    if (!data.tts) setVoiceWait(false);
    else void a.preload(voiceUrls, (ok) => setVoices((v) => ({ done: v.done + 1, ok: v.ok + (ok ? 1 : 0) }))).then(() => setVoiceWait(false));
    // Au-delà de 25 s, on n'attend plus les voix manquantes (sous-titres seuls pour elles).
    const t = setTimeout(() => setVoiceWait(false), 25_000);
    return () => clearTimeout(t);
    // Une seule préparation par match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /**
   * Fait parler l'orateur (voix Fish Audio). Les mots des sous-titres s'allument au rythme de la voix ;
   * sans son (ou voix indisponible), le texte défile à la vitesse d'une lecture normale.
   */
  const say = async (text: string, url: string | null, check: () => void) => {
    const a = audioRef.current;
    const dur = (a && url && !a.muted && (await a.duration(url))) || null;
    check();
    setCaption({ text, upTo: -1 });
    const t0 = performance.now();
    const total = dur ?? Math.max(1.5, text.split(/\s+/).length * 0.3);
    const timer = setInterval(() => setCaption((c) => (c ? { ...c, upTo: ((performance.now() - t0) / 1000 / total) * text.length } : c)), 80);
    try {
      if (dur && a && url) await a.clip(url);
      else await new Promise((r) => setTimeout(r, total * 1000 + 300));
      check();
    } finally {
      clearInterval(timer);
      setCaption((c) => (c ? { ...c, upTo: 1e9 } : c));
    }
  };

  const run = async () => {
    const id = ++runRef.current;
    const check = () => {
      if (runRef.current !== id) throw new Cancelled();
    };
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)).then(check);
    const s = sceneRef.current;
    const a = audioRef.current;
    try {
      // 1. Plan d'ensemble : la salle, les journalistes, les flashs.
      setCaption(null);
      setPhase('intro');
      a?.ambience(0.24);
      s?.cue('establish');
      await wait(4800);

      // 2. L'orateur prend la parole.
      setPhase('speech');
      s?.cue('speak');
      a?.duck(0.08);
      await wait(700);
      await say(data.speech.intro.text, data.speech.intro.url, check);
      setCaption(null);

      // 3. Mitraillage de flashs, poussée de caméra, éclair.
      s?.cue('climax');
      a?.duck(0.3);
      a?.riser(1.35);
      await wait(1400);
      setPhase('eclair');
      a?.crackle(0.34);
      s?.cue('reveal');
      a?.duck(0.12);
      await wait(2700);

      // 4. Chaque joueur : éclair, photo, prénom prononcé, deux secondes à l'écran.
      for (let i = 0; i < data.players.length; i++) {
        const p = data.players[i];
        setIdx(i);
        setPhase('player');
        // L'éclair tombe (≈ 0,34 s) et s'écrase : impact, prénom.
        a?.crackle(0.34);
        await wait(340);
        a?.stinger(Math.floor(i / 2));
        s?.burst(p.mine ? 12 : 6);
        await wait(120);
        const voiceDone = a && !a.muted ? a.clip(p.voice) : Promise.resolve(false);
        await Promise.all([wait(data.hold * 1000), voiceDone]);
        check();
      }

      // 5. Le groupe au complet et le rendez-vous.
      setPhase('final');
      setFlash((f) => f + 1);
      a?.fanfare();
      s?.cue('final');
      a?.duck(0.2);
      if (data.speech.outro) {
        await wait(900);
        await say(data.speech.outro.text, data.speech.outro.url, check);
        setCaption(null);
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  };

  const start = () => {
    // Le geste de l'utilisateur débloque le son.
    void audioRef.current?.ctx.resume();
    onStart?.();
    void run();
  };

  const skip = () => {
    runRef.current++;
    audioRef.current?.stopVoice();
    setCaption(null);
    setPhase('final');
    setFlash((f) => f + 1);
    sceneRef.current?.cue('final');
    audioRef.current?.duck(0.2);
  };

  const replay = () => {
    audioRef.current?.stopVoice();
    start();
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audioRef.current?.setMuted(m);
  };

  const player = data.players[idx];
  const running = phase !== 'poster' && phase !== 'final';
  const scenePhase = phase === 'player' || phase === 'eclair' ? 'dim' : phase === 'final' ? 'soft' : '';

  return (
    <div className={`pc phase-${phase}`} style={{ ['--team' as string]: color } as CSSProperties}>
      <canvas ref={canvasRef} className={`pc-canvas ${scenePhase}`} />
      {no3d && <div className="pc-fallback" aria-hidden />}
      <div className="pc-vignette" aria-hidden />
      {flash > 0 && <div className="rv-flash" key={`flash-${flash}`} />}

      {/* Bandes cinéma pendant la séquence d'ouverture */}
      <div className={`pc-bars${phase === 'intro' || phase === 'speech' ? ' on' : ''}`} aria-hidden>
        <i />
        <i />
      </div>

      <header className="pc-top">
        {onClose && (
          <button className="rv-icon" onClick={onClose} aria-label="Fermer">
            {phase === 'final' ? <ArrowLeft /> : <X />}
          </button>
        )}
        {data.preview && <span className="pc-preview">Aperçu<span className="hide-mobile"> · pas encore publiée</span></span>}
        <span className="grow" />
        {phase !== 'poster' && (
          <button className="rv-icon" onClick={toggleMute} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        )}
        {running && (
          <button className="rv-icon" onClick={skip} aria-label="Passer à la liste">
            <SkipForward />
          </button>
        )}
        {phase === 'final' && (
          <button className="rv-icon" onClick={replay} aria-label="Revoir la conférence">
            <RotateCcw />
          </button>
        )}
      </header>

      {/* Habillage télé : direct, logo de la chaîne, bandeau, défilant */}
      {(phase === 'intro' || phase === 'speech') && (
        <div className="pc-tv">
          <div className="pc-live">
            <i /> EN DIRECT
          </div>
          {logo && <img className={`pc-bug${look?.clean === false ? ' plate' : ''}`} src={logo} alt="" />}
          {phase === 'speech' && speaker && (
            <div className="pc-lower">
              <b>{speaker.name}</b>
              <span>{speaker.role || `Coach ${data.group}`}</span>
            </div>
          )}
          {caption && <Caption text={caption.text} upTo={caption.upTo} />}
          <div className="pc-ticker">
            <b>CONVOCATION {data.group}</b>
            <div>
              <span>
                {[data.title, dayWords(data.date), data.meetTime && `RDV ${hour(data.meetTime)}`, data.time && `Coup d’envoi ${hour(data.time)}`, `${data.players.length} joueurs convoqués`]
                  .filter(Boolean)
                  .join('   •   ')}
                {'   •   '}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Affiche : lancement (le son a besoin d'un geste) */}
      {phase === 'poster' && (
        <div className="pc-poster">
          {logo && <img className={`pc-poster-logo${look?.clean === false ? ' plate' : ''}`} src={logo} alt="" />}
          <small className="pc-kicker">🎙️ Conférence de presse</small>
          <h1 className="pc-poster-title">
            Convocation <em>{data.group}</em>
          </h1>
          <p className="pc-poster-sub">{matchLine}</p>
          <button className="pc-play" onClick={start} disabled={!ready || voiceWait} aria-label="Lancer la conférence de presse">
            {ready && !voiceWait ? <Play fill="currentColor" /> : <Spinner />}
          </button>
          <p className="pc-poster-hint">
            {!ready
              ? 'Installation des caméras…'
              : voiceWait
                ? `Les coachs s’échauffent la voix… ${voices.done}/${voiceUrls.length}`
                : hasMine
                  ? '🔊 Montez le son… votre enfant sera-t-il annoncé ?'
                  : '🔊 Montez le son'}
          </p>
        </div>
      )}

      {/* Éclair : titre de la convocation */}
      {phase === 'eclair' && (
        <LightningReveal key="eclair" glow={glow} onMeet={() => (audioRef.current?.thunder(), setFlash((f) => f + 1))}>
          <div className="pc-rift-title">
            <small>Convocation</small>
            <b>{data.group}</b>
            <span>{matchLine}</span>
          </div>
        </LightningReveal>
      )}

      {/* Un joueur à la fois : il surgit dans la brèche de l'éclair */}
      {phase === 'player' && player && (
        <>
          <span className="pc-count">
            {idx + 1} / {data.players.length}
          </span>
          <LightningReveal key={player.id} glow={player.mine ? '#ffc94a' : glow} className={player.mine ? 'mine' : ''}>
            <PlayerInRift p={player} />
          </LightningReveal>
          {player.mine && <span className="pc-mine">⭐ Votre enfant est convoqué !</span>}
          {player.mine && <Confetti colors={['#ffd76a', '#ffffff', color, '#d5f58e']} />}
          <div className="pc-dots" aria-hidden>
            {data.players.map((p, i) => (
              <i key={p.id} className={i < idx ? 'done' : i === idx ? 'now' : ''} />
            ))}
          </div>
        </>
      )}

      {/* Le groupe : date du match, cartes des convoqués, puis les actions tout en bas */}
      {phase === 'final' && (
        <>
          <div className="pc-final">
            {hasMine && <Confetti colors={['#ffd76a', '#ffffff', color, '#d5f58e']} />}
            <small className="pc-kicker">Convocation {data.group}</small>
            <h2 className="pc-final-title">{whenTitle(data.date, data.time || data.meetTime)}</h2>
            {data.meetTime && data.time && data.meetTime !== data.time && <p className="pc-final-sub">Rendez-vous à {hour(data.meetTime)}</p>}
            <div className="pc-cards">
              {data.players.map((p, i) => (
                <div key={p.id} className={`pc-card${p.mine ? ' mine' : ''}`} style={{ ['--i' as string]: i } as CSSProperties}>
                  <FutCard
                    card={p.card}
                    team={{ category: data.group, color, logo: data.club.logo }}
                    size={170}
                    foot={
                      <>
                        {p.number != null && <span>#{p.number}</span>}
                        {p.mine && <span>⭐ Mon enfant</span>}
                      </>
                    }
                  />
                </div>
              ))}
            </div>
            {data.message && <p className="pc-msg">« {data.message} »</p>}
            {caption && <Caption text={caption.text} upTo={caption.upTo} />}
          </div>
          <div className="pc-actions">
            <button className="btn lg" onClick={replay}>
              <RotateCcw /> Revoir
            </button>
            {onClose && (
              <button className="btn lg lime" onClick={onClose}>
                <ClipboardList /> {data.preview ? 'Retour à la convocation' : 'Voir la convocation'}
              </button>
            )}
            {!onClose && data.published && (
              <Link className="btn lg lime" to="/">
                <Link2 /> Ouvrir Atelier
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
