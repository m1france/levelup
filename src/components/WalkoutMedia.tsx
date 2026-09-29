import { ImageUp, Play, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { prepareFullBody } from '../lib/images';
import type { Player } from '../lib/types';
import { Sheet, useConfirm, useToast } from './ui';

/**
 * Entrée sur le terrain (fiche joueur) : la photo en pied de l'enfant,
 * qui apparaît sur l'estrade à côté de sa carte quand il est convoqué.
 */

const photoSrc = (p: Player) => (p.walkout?.photo ? `/api/players/${p.id}/walkout/photo?v=${p.walkout.photo.v}` : null);

export function WalkoutCard({ player, canEdit, onChange }: { player: Player; canEdit: boolean; onChange: (p: Player) => void }) {
  const [open, setOpen] = useState(false);
  const photo = photoSrc(player);
  const refused = player.info?.photoConsent === 'no';
  const status = refused
    ? 'Autorisation photo refusée : son entrée se fera sans photo.'
    : photo
      ? player.walkout?.photo?.alpha ? 'Photo détourée' : 'Photo en pied'
      : `Ajoutez une photo en pied : ${player.firstName} apparaîtra sur l’estrade à côté de sa carte.`;
  return (
    <section className="wko">
      <button type="button" className="wko-thumb" onClick={() => canEdit && setOpen(true)} aria-label="Photo en pied">
        {photo ? <img src={photo} alt="" /> : <Sparkles size={22} />}
      </button>
      <div className="wko-text">
        <b>Entrée sur le terrain</b>
        <small>{status}</small>
      </div>
      <div className="wko-actions">
        <Link className="wko-btn gold" to={`/joueurs/${player.id}/entree`}>
          <Play size={15} fill="currentColor" /> Voir
        </Link>
        {canEdit && (
          <button type="button" className="wko-btn" onClick={() => setOpen(true)}>
            {photo ? 'Modifier' : 'Ajouter'}
          </button>
        )}
      </div>
      {open && <WalkoutEditor player={player} onChange={onChange} onClose={() => setOpen(false)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ éditeur */

interface Draft {
  canvas: HTMLCanvasElement;
  url: string;
  alpha: boolean;
  /** Photo d'origine (pour revenir en arrière après un détourage). */
  original?: Draft;
}

const draftOf = (canvas: HTMLCanvasElement, alpha: boolean, original?: Draft): Draft => ({
  canvas,
  alpha,
  original,
  url: canvas.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.9),
});

function WalkoutEditor({ player, onChange, onClose }: { player: Player; onChange: (p: Player) => void; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const photoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'photo' | 'cutout'>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const photo = photoSrc(player);
  const alpha = !!player.walkout?.photo?.alpha;

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Une erreur est survenue', true);

  const choosePhoto = async (file?: File) => {
    if (!file) return;
    setBusy('photo');
    try {
      const c = await prepareFullBody(file);
      const { trimAlpha, hasTransparentEdges } = await import('../walkout/cutout');
      // PNG déjà détouré : recadré sur l'enfant et enregistré tel quel.
      if (hasTransparentEdges(c)) await savePhoto(draftOf(trimAlpha(c), true));
      else setDraft(draftOf(c, false));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const cutout = async (from: Draft | null) => {
    setBusy('cutout');
    try {
      let src = from?.canvas;
      if (!src && photo) {
        const img = new Image();
        img.src = photo;
        await img.decode();
        src = document.createElement('canvas');
        src.width = img.naturalWidth;
        src.height = img.naturalHeight;
        src.getContext('2d')!.drawImage(img, 0, 0);
      }
      if (!src) return;
      const { cutoutPhoto } = await import('../walkout/cutout');
      const out = await cutoutPhoto(src);
      setDraft(draftOf(out, true, from ?? draftOf(src, false)));
    } catch (e) {
      fail(e instanceof Error && /fetch|network|Failed/i.test(e.message) ? new Error('Détourage indisponible (connexion ?)') : e);
    } finally {
      setBusy(null);
    }
  };

  const savePhoto = async (d: Draft) => {
    setBusy('photo');
    try {
      const out = await api.post<Player>(`/players/${player.id}/walkout/photo`, { image: d.url, alpha: d.alpha });
      onChange(out);
      setDraft(null);
      toast(d.alpha ? 'Photo détourée enregistrée' : 'Photo enregistrée');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const removePhoto = async () => {
    if (!(await confirm({ title: 'Supprimer la photo en pied ?', confirm: 'Supprimer', danger: true }))) return;
    try {
      onChange(await api.del<Player>(`/players/${player.id}/walkout/photo`));
    } catch (e) {
      fail(e);
    }
  };

  const shown = draft?.url ?? photo;
  const shownAlpha = draft ? draft.alpha : alpha;

  return (
    <Sheet
      title="Entrée sur le terrain"
      onClose={onClose}
      wide
      footer={
        <>
          <Link className="btn" to={`/joueurs/${player.id}/entree`}>
            <Play size={16} /> Voir son entrée
          </Link>
          <button className="btn primary" onClick={onClose}>
            Terminé
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Quand {player.firstName} est convoqué, il apparaît sur l’estrade à côté de sa carte : sa photo en pied, idéalement détourée.
        {player.info?.photoConsent === 'no' && <b> L’autorisation photo est refusée : la photo ne sera pas affichée.</b>}
      </p>
      <div className="wko-grid">
        <div className="wko-tile">
          <div className={`wko-stage${shownAlpha ? ' clear' : ''}`}>
            {shown ? <img src={shown} alt="" /> : <span className="wko-empty"><ImageUp size={28} /> Photo en pied</span>}
            {busy === 'cutout' && <span className="wko-busy">Détourage en cours…</span>}
            {shown && <span className={`wko-badge${shownAlpha ? ' ok' : ''}`}>{shownAlpha ? 'Fond transparent' : 'Fond non détouré'}</span>}
          </div>
          <b>Photo en pied</b>
          <small className="muted">Debout, de la tête aux pieds, sur un fond simple. Idéalement un PNG déjà détouré.</small>
          {draft ? (
            <div className="wko-row">
              {!draft.alpha && (
                <button className="btn primary" disabled={!!busy} onClick={() => void cutout(draft)}>
                  <Wand2 size={16} /> Détourer automatiquement
                </button>
              )}
              <button className={`btn${draft.alpha ? ' primary' : ''}`} disabled={!!busy} onClick={() => void savePhoto(draft)}>
                {draft.alpha ? 'Utiliser ce détourage' : 'Garder tel quel'}
              </button>
              <button className="btn ghost" disabled={!!busy} onClick={() => setDraft(draft.original && draft.alpha ? draft.original : null)}>
                Annuler
              </button>
            </div>
          ) : (
            <div className="wko-row">
              <button className={`btn${photo ? '' : ' primary'}`} disabled={!!busy} onClick={() => photoInput.current?.click()}>
                <ImageUp size={16} /> {photo ? 'Changer' : 'Choisir une photo'}
              </button>
              {photo && !alpha && (
                <button className="btn" disabled={!!busy} onClick={() => void cutout(null)}>
                  <Wand2 size={16} /> Détourer
                </button>
              )}
              {photo && (
                <button className="btn ghost icon" disabled={!!busy} onClick={() => void removePhoto()} aria-label="Supprimer la photo">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => (void choosePhoto(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
      </div>
    </Sheet>
  );
}
