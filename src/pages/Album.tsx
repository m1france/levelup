import { ChevronLeft, ChevronRight, Download, ImagePlus, Images, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Empty, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api } from '../lib/api';
import { preparePhoto } from '../lib/images';
import { useApp } from '../lib/store';
import type { Photo } from '../lib/types';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function Album() {
  const { team, can, isStaff, me } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = useAsync(() => (team ? api.get<Photo[]>(`/teams/${team.id}/photos`) : Promise.resolve([])), [team?.id]);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const canAdd = isStaff && can('album.manage');

  const photos = q.data ?? [];
  const openId = params.get('photo');
  const openIndex = photos.findIndex((p) => p.id === openId);

  useEffect(() => {
    if (params.get('ajouter') && canAdd) {
      input.current?.click();
      setParams({}, { replace: true });
    }
  }, [params, canAdd, setParams]);

  const groups = useMemo(() => {
    const map = new Map<string, Photo[]>();
    for (const p of photos) {
      const d = new Date(p.takenAt);
      const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map];
  }, [photos]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !team) return;
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    setUploading({ done: 0, total: list.length });
    let ok = 0;
    for (const [i, f] of list.entries()) {
      try {
        await api.post(`/teams/${team.id}/photos`, await preparePhoto(f));
        ok++;
      } catch (e) {
        toast(`${f.name} : ${(e as Error).message}`, true);
      }
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    if (ok) toast(ok > 1 ? `${ok} photos ajoutées` : 'Photo ajoutée');
    q.reload();
  };

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
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
      </div>

      {q.loading && !q.data ? (
        <Spinner fill />
      ) : photos.length ? (
        groups.map(([month, list]) => (
          <section key={month} style={{ marginBottom: 28 }}>
            <div className="sec-head" style={{ marginTop: 0 }}>
              <h2>{month}</h2>
              <span className="muted small">{list.length}</span>
            </div>
            <div className="masonry">
              {list.map((p) => (
                <button key={p.id} className="tile" onClick={() => setParams({ photo: p.id })} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                  <img src={`/api/photos/${p.id}/thumb`} alt={p.caption} loading="lazy" />
                  {p.caption && <span className="tile-cap">{p.caption}</span>}
                </button>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="album-empty" onClick={() => canAdd && input.current?.click()} style={{ cursor: canAdd ? 'pointer' : undefined }}>
          <Empty icon={<Images />} title="Aucune photo" text={canAdd ? 'Ajoutez les photos de vos séances et plateaux.' : undefined} />
        </div>
      )}

      {openIndex >= 0 && (
        <Lightbox
          photos={photos}
          index={openIndex}
          canEdit={(p) => me.user.role === 'admin' || p.authorId === me.user.id || canAdd}
          onIndex={(i) => setParams({ photo: photos[i].id }, { replace: true })}
          onClose={() => setParams({})}
          onChanged={q.reload}
        />
      )}
    </div>
  );
}

function Lightbox({
  photos, index, canEdit, onIndex, onClose, onChanged,
}: { photos: Photo[]; index: number; canEdit: (p: Photo) => boolean; onIndex: (i: number) => void; onClose: () => void; onChanged: () => void }) {
  const p = photos[index];
  const confirm = useConfirm();
  const [caption, setCaption] = useState(p.caption);
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

  // Glisser à gauche / à droite sur mobile.
  const touch = useRef<number | null>(null);
  const editable = canEdit(p);
  const saveCaption = async () => {
    if (caption === p.caption) return;
    await api.patch(`/photos/${p.id}`, { caption });
    onChanged();
  };

  return createPortal(
    <div className="lightbox" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lb-top">
        <span className="lb-count">
          {index + 1} / {photos.length}
        </span>
        <span className="grow" />
        <a className="lb-btn" href={`/api/photos/${p.id}/full`} download={`souvenir-${p.id}.jpg`} aria-label="Télécharger">
          <Download />
        </a>
        {editable && (
          <button
            className="lb-btn"
            aria-label="Supprimer"
            onClick={async () => {
              if (!(await confirm({ title: 'Supprimer cette photo ?', confirm: 'Supprimer', danger: true }))) return;
              await api.del(`/photos/${p.id}`);
              if (photos.length <= 1) onClose();
              else onIndex(index === photos.length - 1 ? index - 1 : index);
              onChanged();
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
        {index < photos.length - 1 && (
          <button className="lb-nav next" onClick={() => onIndex(index + 1)} aria-label="Suivante">
            <ChevronRight />
          </button>
        )}
      </div>
      <div className="lb-foot">
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
        <small>{new Date(p.takenAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</small>
      </div>
    </div>,
    document.body,
  );
}
