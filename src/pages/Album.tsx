import { ChevronLeft, ChevronRight, Download, ImagePlus, Images, Share2, Tag, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Empty, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api } from '../lib/api';
import { preparePhoto } from '../lib/images';
import { useApp } from '../lib/store';
import type { Photo, Player } from '../lib/types';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const REACTIONS = ['❤️', '👏', '🔥', '😍', '⚽'];

interface Group { key: string; title: string; sub: string; score?: { us: number; them: number } | null; photos: Photo[] }

function groupPhotos(photos: Photo[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of photos) {
    let key: string;
    let title: string;
    let sub: string;
    if (p.event) {
      key = `e${p.event.id}${p.event.date}`;
      title = p.event.title;
      const d = new Date(`${p.event.date}T12:00`);
      sub = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    } else {
      const d = new Date(p.takenAt);
      key = `m${d.getFullYear()}-${d.getMonth()}`;
      title = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      sub = '';
    }
    const g = map.get(key) ?? { key, title, sub, score: p.event?.score ?? null, photos: [] };
    g.photos.push(p);
    map.set(key, g);
  }
  return [...map.values()];
}

export function Album() {
  const { team, can, isStaff, me } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = useAsync(() => (team ? api.get<Photo[]>(`/teams/${team.id}/photos`) : Promise.resolve([])), [team?.id]);
  const roster = useAsync(() => (team ? api.get<Player[]>(`/teams/${team.id}/players`) : Promise.resolve([])), [team?.id]);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [story, setStory] = useState<Group | null>(null);
  const canAdd = isStaff && can('album.manage');
  const kids = me.children.filter((c) => c.teamId === team?.id);
  const filter = params.get('filtre') ?? 'tout';

  const all = q.data ?? [];
  const photos = useMemo(() => {
    if (filter === 'tout') return all;
    if (filter === 'matchs') return all.filter((p) => p.event);
    return all.filter((p) => p.tags.some((t) => t.id === filter));
  }, [all, filter]);
  const groups = useMemo(() => groupPhotos(photos), [photos]);
  const stories = useMemo(() => groupPhotos(all).filter((g) => g.key.startsWith('e')).slice(0, 12), [all]);
  const openId = params.get('photo');
  const openIndex = photos.findIndex((p) => p.id === openId);
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v === null) n.delete(k);
    else n.set(k, v);
    setParams(n, { replace: k === 'photo' && !!params.get('photo') });
  };

  useEffect(() => {
    if (params.get('ajouter') && canAdd) {
      input.current?.click();
      setParam('ajouter', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canAdd]);

  const upload = async (files: File[], meta: { eventId?: string; eventDate?: string; tags: string[] }) => {
    if (!team) return;
    setPending(null);
    setUploading({ done: 0, total: files.length });
    let ok = 0;
    for (const [i, f] of files.entries()) {
      try {
        await api.post(`/teams/${team.id}/photos`, { ...(await preparePhoto(f)), ...meta });
        ok++;
      } catch (e) {
        toast(`${f.name} : ${(e as Error).message}`, true);
      }
      setUploading({ done: i + 1, total: files.length });
    }
    setUploading(null);
    if (ok) toast(ok > 1 ? `${ok} photos ajoutées` : 'Photo ajoutée');
    q.reload();
  };

  const chips = [
    { key: 'tout', label: 'Tout' },
    ...kids.map((k) => ({ key: k.id, label: `⭐ ${k.firstName}` })),
    { key: 'matchs', label: 'Matchs' },
  ];

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Album souvenir</h1>
        {canAdd && (
          <div className="actions">
            <button className="btn primary" onClick={() => input.current?.click()} disabled={!!uploading}>
              <ImagePlus /> {uploading ? `${uploading.done}/${uploading.total}` : 'Ajouter'}
            </button>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (files.length) setPending(files);
            e.target.value = '';
          }}
        />
      </div>

      {stories.length > 0 && (
        <div className="stories">
          {stories.map((g) => (
            <button key={g.key} className="story" onClick={() => setStory(g)}>
              <span className="story-ring">
                <img src={`/api/photos/${g.photos[0].id}/thumb`} alt="" />
              </span>
              <small>{g.title.replace(/^Match (contre|à) /, '')}</small>
            </button>
          ))}
        </div>
      )}

      <div className="chips scroll" style={{ marginBottom: 18 }}>
        {chips.map((c) => (
          <button key={c.key} className={`chip${filter === c.key ? ' on' : ''}`} onClick={() => setParam('filtre', c.key === 'tout' ? null : c.key)}>
            {c.label}
          </button>
        ))}
        {isStaff && (
          <select className="chip-select" value={chips.some((c) => c.key === filter) ? '' : filter} onChange={(e) => setParam('filtre', e.target.value || null)}>
            <option value="">Par joueur…</option>
            {(roster.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName}
              </option>
            ))}
          </select>
        )}
      </div>

      {q.loading && !q.data ? (
        <Spinner fill />
      ) : photos.length ? (
        groups.map((g) => (
          <section key={g.key} className="al-group">
            <div className="al-head">
              <div>
                <h2>{g.title}</h2>
                {g.sub && <small>{g.sub}</small>}
              </div>
              {g.score && (
                <span className="al-score">
                  {g.score.us} – {g.score.them}
                </span>
              )}
              <span className="grow" />
              {g.key.startsWith('e') && (
                <button className="btn sm ghost" onClick={() => setStory(g)}>
                  ▶ Diaporama
                </button>
              )}
            </div>
            <div className="al-grid">
              {g.photos.map((p) => (
                <button key={p.id} className="al-tile" onClick={() => setParam('photo', p.id)}>
                  <img src={`/api/photos/${p.id}/thumb`} alt={p.caption} loading="lazy" />
                  {Object.keys(p.reactions).length > 0 && (
                    <span className="al-react">
                      {Object.entries(p.reactions)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([e]) => e)
                        .join('')}{' '}
                      {Object.values(p.reactions).reduce((a, b) => a + b, 0)}
                    </span>
                  )}
                  {kids.some((k) => p.tags.some((t) => t.id === k.id)) && <span className="al-star">⭐</span>}
                </button>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="album-empty" onClick={() => canAdd && input.current?.click()} style={{ cursor: canAdd ? 'pointer' : undefined }}>
          <Empty icon={<Images />} title={filter === 'tout' ? 'Aucune photo' : 'Aucune photo pour ce filtre'} text={canAdd ? 'Ajoutez les photos de vos séances et de vos matchs.' : undefined} />
        </div>
      )}

      {pending && team && <UploadSheet files={pending} teamId={team.id} players={roster.data ?? []} onClose={() => setPending(null)} onGo={(meta) => upload(pending, meta)} />}
      {story && <StoryViewer group={story} onClose={() => setStory(null)} />}
      {openIndex >= 0 && (
        <Lightbox
          photos={photos}
          index={openIndex}
          players={roster.data ?? []}
          canEdit={(p) => me.user.role === 'admin' || p.authorId === me.user.id || canAdd}
          onIndex={(i) => setParam('photo', photos[i].id)}
          onClose={() => setParam('photo', null)}
          onChanged={(p) => q.setData(all.map((x) => (x.id === p.id ? p : x)))}
          onDeleted={q.reload}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ajout */

function TagChips({ players, value, onChange }: { players: Player[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      {players.map((p) => {
        const no = p.info?.photoConsent === 'no';
        return (
          <button
            key={p.id}
            type="button"
            className={`chip${value.includes(p.id) ? ' on' : ''}${no ? ' no-consent' : ''}`}
            onClick={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])}
            title={no ? 'Les parents ont refusé les photos' : undefined}
          >
            {no ? '🚫 ' : ''}
            {p.firstName}
          </button>
        );
      })}
    </div>
  );
}

function UploadSheet({ files, teamId, players, onClose, onGo }: { files: File[]; teamId: string; players: Player[]; onClose: () => void; onGo: (m: { eventId?: string; eventDate?: string; tags: string[] }) => void }) {
  const events = useAsync(() => api.get<{ id: string; date: string; title: string }[]>(`/teams/${teamId}/photo-events`), [teamId]);
  const [ev, setEv] = useState<{ id: string; date: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const previews = useMemo(() => files.slice(0, 6).map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
  const refused = players.filter((p) => tags.includes(p.id) && p.info?.photoConsent === 'no');
  return (
    <Sheet
      title={`${files.length} photo${files.length > 1 ? 's' : ''}`}
      onClose={onClose}
      footer={
        <button className="btn primary lg block" onClick={() => onGo({ eventId: ev?.id, eventDate: ev?.date, tags })}>
          <ImagePlus /> Ajouter à l’album
        </button>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <div className="up-previews">
          {previews.map((u) => (
            <img key={u} src={u} alt="" />
          ))}
          {files.length > 6 && <span>+{files.length - 6}</span>}
        </div>
        <div>
          <span className="lbl">Souvenir de</span>
          <div className="chips">
            <button className={`chip${!ev ? ' on' : ''}`} onClick={() => setEv(null)}>
              Aucun match
            </button>
            {(events.data ?? []).map((e) => (
              <button key={e.id + e.date} className={`chip${ev?.id === e.id && ev.date === e.date ? ' on' : ''}`} onClick={() => setEv({ id: e.id, date: e.date })}>
                {e.title} · {new Date(`${e.date}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="lbl">
            <Users size={12} /> Qui est sur {files.length > 1 ? 'ces photos' : 'la photo'} ?
          </span>
          <TagChips players={players} value={tags} onChange={setTags} />
          <p className="small muted" style={{ marginTop: 8 }}>Les parents retrouvent toutes les photos de leur enfant d’un geste (filtre ⭐).</p>
          {refused.length > 0 && <p className="form-error" style={{ marginTop: 8 }}>Les parents de {refused.map((p) => p.firstName).join(', ')} ont refusé les photos dans l’album.</p>}
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ diaporama « stories » */

function StoryViewer({ group, onClose }: { group: Group; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const DUR = 4200;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => (i < group.photos.length - 1 ? setI(i + 1) : onClose()), DUR);
    return () => clearTimeout(t);
  }, [i, paused, group.photos.length, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(group.photos.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [group.photos.length, onClose]);
  const p = group.photos[i];
  return createPortal(
    <div className="story-view" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
      <div className="story-bars">
        {group.photos.map((x, k) => (
          <span key={x.id}>
            <i className={k < i ? 'full' : k === i ? `run${paused ? ' paused' : ''}` : ''} style={{ animationDuration: `${DUR}ms` }} key={k === i ? `r${i}` : undefined} />
          </span>
        ))}
      </div>
      <div className="story-top">
        <div className="grow">
          <b>{group.title}</b>
          <small>
            {group.sub}
            {group.score ? ` · ${group.score.us} – ${group.score.them}` : ''}
          </small>
        </div>
        <button className="lb-btn" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <img key={p.id} className="story-img" src={`/api/photos/${p.id}/full`} alt={p.caption} />
      {p.caption && <p className="story-cap">{p.caption}</p>}
      <button className="story-nav prev" onClick={() => setI(Math.max(0, i - 1))} aria-label="Précédente" />
      <button className="story-nav next" onClick={() => (i < group.photos.length - 1 ? setI(i + 1) : onClose())} aria-label="Suivante" />
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ visionneuse */

function Lightbox({
  photos, index, players, canEdit, onIndex, onClose, onChanged, onDeleted,
}: {
  photos: Photo[]; index: number; players: Player[]; canEdit: (p: Photo) => boolean; onIndex: (i: number) => void; onClose: () => void;
  onChanged: (p: Photo) => void; onDeleted: () => void;
}) {
  const p = photos[index];
  const confirm = useConfirm();
  const toast = useToast();
  const [caption, setCaption] = useState(p.caption);
  const [tagging, setTagging] = useState(false);
  const [burst, setBurst] = useState<string | null>(null);
  useEffect(() => setCaption(p.caption), [p.id, p.caption]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onIndex]);

  const touch = useRef<number | null>(null);
  const editable = canEdit(p);
  const saveCaption = async () => {
    if (caption === p.caption) return;
    await api.patch(`/photos/${p.id}`, { caption });
    onChanged({ ...p, caption });
  };
  const react = async (emoji: string) => {
    if (p.myReaction !== emoji) {
      setBurst(emoji);
      setTimeout(() => setBurst(null), 900);
    }
    onChanged(await api.post<Photo>(`/photos/${p.id}/react`, { emoji }));
  };
  const share = async () => {
    try {
      const blob = await (await fetch(`/api/photos/${p.id}/full`)).blob();
      const file = new File([blob], `souvenir-${p.id}.jpg`, { type: 'image/jpeg' });
      if ((navigator as Navigator & { canShare?: (d: ShareData) => boolean }).canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else toast('Utilisez le bouton de téléchargement');
    } catch {
      /* partage annulé */
    }
  };

  return createPortal(
    <div className="lightbox" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lb-top">
        <span className="lb-count">
          {index + 1} / {photos.length}
        </span>
        <span className="grow" />
        <button className="lb-btn" onClick={share} aria-label="Partager">
          <Share2 />
        </button>
        <a className="lb-btn" href={`/api/photos/${p.id}/full`} download={`souvenir-${p.id}.jpg`} aria-label="Télécharger">
          <Download />
        </a>
        {editable && (
          <button className="lb-btn" onClick={() => setTagging(true)} aria-label="Identifier les enfants">
            <Tag />
          </button>
        )}
        {editable && (
          <button
            className="lb-btn"
            aria-label="Supprimer"
            onClick={async () => {
              if (!(await confirm({ title: 'Supprimer cette photo ?', confirm: 'Supprimer', danger: true }))) return;
              await api.del(`/photos/${p.id}`);
              if (photos.length <= 1) onClose();
              else onIndex(index === photos.length - 1 ? index - 1 : index);
              onDeleted();
            }}
          >
            <Trash2 />
          </button>
        )}
        <button className="lb-btn" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
      </div>
      <div
        className="lb-stage"
        onDoubleClick={() => react('❤️')}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (dx < -50 && index < photos.length - 1) onIndex(index + 1);
          if (dx > 50 && index > 0) onIndex(index - 1);
        }}
      >
        {index > 0 && (
          <button className="lb-nav prev" onClick={() => onIndex(index - 1)} aria-label="Précédente">
            <ChevronLeft />
          </button>
        )}
        <img key={p.id} src={`/api/photos/${p.id}/full`} alt={p.caption} />
        {burst && <span className="lb-burst">{burst}</span>}
        {index < photos.length - 1 && (
          <button className="lb-nav next" onClick={() => onIndex(index + 1)} aria-label="Suivante">
            <ChevronRight />
          </button>
        )}
      </div>
      <div className="lb-foot">
        <div className="lb-reactions">
          {REACTIONS.map((e) => (
            <button key={e} className={p.myReaction === e ? 'on' : ''} onClick={() => react(e)}>
              {e}
              {p.reactions[e] ? <small>{p.reactions[e]}</small> : null}
            </button>
          ))}
        </div>
        {p.tags.length > 0 && (
          <div className="lb-tags">
            {p.tags.map((t) => (
              <span key={t.id}>{t.firstName}</span>
            ))}
          </div>
        )}
        {editable ? (
          <input
            className="lb-caption"
            value={caption}
            placeholder="Ajouter une légende…"
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          p.caption && <span>{p.caption}</span>
        )}
        <small>
          {p.event ? `${p.event.title} · ` : ''}
          {new Date(p.takenAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </small>
      </div>
      {tagging && (
        <Sheet
          title="Qui est sur la photo ?"
          onClose={() => setTagging(false)}
          footer={
            <button className="btn primary" onClick={() => setTagging(false)}>
              Terminé
            </button>
          }
        >
          <TagChips
            players={players}
            value={p.tags.map((t) => t.id)}
            onChange={async (tags) => onChanged(await api.put<Photo>(`/photos/${p.id}/tags`, { tags }))}
          />
        </Sheet>
      )}
    </div>,
    document.body,
  );
}
