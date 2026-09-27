import { Car, Clock, MapPin, Minus, Plus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import type { Carpool, CarpoolOffer, Direction } from '../lib/types';
import { Avatar, Sheet, useAsync, useConfirm, useToast } from './ui';

export const DIRECTION: Record<Direction, { label: string; short: string }> = {
  aller: { label: 'Aller', short: 'Aller' },
  retour: { label: 'Retour', short: 'Retour' },
  both: { label: 'Aller et retour', short: 'A/R' },
};

export function useCarpool(eventId: string, date: string) {
  const q = useAsync(() => api.get<Carpool>(`/carpool/${eventId}/${date}`), [eventId, date]);
  useLive((m) => m.t === 'carpool' && m.eventId === eventId && m.date === date && q.reload());
  return q;
}

/** Places de la voiture : sièges occupés (initiale de l'enfant) et libres. */
function Seats({ offer }: { offer: CarpoolOffer }) {
  return (
    <span className="seats" aria-label={`${offer.free} place${offer.free > 1 ? 's' : ''} libre${offer.free > 1 ? 's' : ''} sur ${offer.seats}`}>
      {Array.from({ length: offer.seats }, (_, i) => {
        const b = offer.bookings[i];
        return (
          <i key={i} className={b ? 'taken' : ''} title={b?.firstName}>
            {b ? b.firstName[0] : ''}
          </i>
        );
      })}
    </span>
  );
}

function OfferCard({ o, cp, onChange }: { o: CarpoolOffer; cp: Carpool; onChange: (c: Carpool) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const kids = cp.kids.filter((k) => !k.booked);
  const book = async (playerId: string) => {
    try {
      onChange(await api.post<Carpool>(`/carpool/offer/${o.id}/book`, { playerId }));
      toast('Place réservée 🚗');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className={`car${o.mine ? ' mine' : ''}`}>
      <div className="car-head">
        <Avatar name={o.driver.name} size="sm" />
        <div className="grow">
          <b>{o.mine ? 'Votre voiture' : o.driver.name}</b>
          <small>
            {DIRECTION[o.direction].label}
            {o.time && ` · départ ${o.time.replace(':', 'h')}`}
          </small>
        </div>
        <Seats offer={o} />
      </div>
      {o.place && (
        <p className="car-line">
          <MapPin size={13} /> {o.place}
        </p>
      )}
      {o.note && <p className="car-line muted">{o.note}</p>}
      {o.bookings.length > 0 && (
        <div className="car-riders">
          {o.bookings.map((b) => (
            <span key={b.playerId} className="rider">
              {b.firstName}
              {(b.mine || o.mine) && (
                <button
                  aria-label={`Retirer ${b.firstName}`}
                  onClick={async () => onChange(await api.del<Carpool>(`/carpool/offer/${o.id}/book/${b.playerId}`))}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="car-actions">
        {!o.mine && o.free > 0 && kids.map((k) => (
          <button key={k.id} className="btn sm primary" onClick={() => book(k.id)}>
            <UserPlus /> Réserver pour {k.firstName}
          </button>
        ))}
        {!o.mine && o.free === 0 && <span className="small muted">Voiture complète</span>}
        {o.mine && (
          <button
            className="btn sm ghost danger"
            onClick={async () => {
              if (await confirm({ title: 'Annuler votre trajet ?', text: o.bookings.length ? 'Les familles inscrites seront prévenues.' : undefined, confirm: 'Annuler le trajet', danger: true })) {
                onChange(await api.del<Carpool>(`/carpool/${o.id}`));
              }
            }}
          >
            Annuler mon trajet
          </button>
        )}
      </div>
    </div>
  );
}

/** Covoiturage d'un match : voitures, places libres, enfants qui cherchent une place. */
export function CarpoolPanel({ eventId, date, compact }: { eventId: string; date: string; compact?: boolean }) {
  const q = useCarpool(eventId, date);
  const [form, setForm] = useState<'offer' | 'request' | null>(null);
  const cp = q.data;
  if (!cp) return <div className="carpool loading" />;
  const open = cp.requests.filter((r) => !r.solved);
  return (
    <div className={`carpool${compact ? ' compact' : ''}`}>
      <div className="carpool-head">
        <span className="carpool-ic">
          <Car />
        </span>
        <div className="grow">
          <b>Covoiturage</b>
          <small>
            {cp.offers.length ? `${cp.free} place${cp.free > 1 ? 's' : ''} libre${cp.free > 1 ? 's' : ''} · ${cp.offers.length} voiture${cp.offers.length > 1 ? 's' : ''}` : 'Personne ne propose encore de place'}
            {open.length ? ` · ${open.length} enfant${open.length > 1 ? 's' : ''} cherche${open.length > 1 ? 'nt' : ''}` : ''}
          </small>
        </div>
      </div>
      {cp.offers.map((o) => (
        <OfferCard key={o.id} o={o} cp={cp} onChange={q.setData} />
      ))}
      {open.length > 0 && (
        <div className="car-needs">
          {open.map((r) => (
            <div key={r.id} className="need">
              <span className="need-dot" />
              <span className="grow">
                <b>{r.firstName}</b> cherche une place <span className="muted">({DIRECTION[r.direction].label.toLowerCase()})</span>
                {r.note && <small> · {r.note}</small>}
              </span>
              {r.mine && (
                <button className="btn icon sm ghost" aria-label="Retirer la demande" onClick={async () => q.setData(await api.del<Carpool>(`/carpool/${r.id}`))}>
                  <X />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="carpool-cta">
        <button className="btn" onClick={() => setForm('offer')}>
          <Car /> Je propose des places
        </button>
        {cp.kids.some((k) => !k.booked) && (
          <button className="btn ghost" onClick={() => setForm('request')}>
            Je cherche une place
          </button>
        )}
      </div>
      {form && <CarpoolForm kind={form} cp={cp} onClose={() => setForm(null)} onDone={(c) => (q.setData(c), setForm(null))} />}
    </div>
  );
}

function CarpoolForm({ kind, cp, onClose, onDone }: { kind: 'offer' | 'request'; cp: Carpool; onClose: () => void; onDone: (c: Carpool) => void }) {
  const toast = useToast();
  const kids = cp.kids.filter((k) => !k.booked);
  const [f, setF] = useState({
    direction: 'both' as Direction, seats: 3, place: '', time: cp.meetTime ? subtract(cp.meetTime, 20) : '', note: '', playerId: kids[0]?.id ?? '', share: true,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onDone(await api.post<Carpool>(`/carpool/${cp.eventId}/${cp.date}`, { ...f, kind }));
      toast(kind === 'offer' ? 'Merci ! Votre trajet est proposé aux familles 🚗' : 'Demande envoyée aux familles');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={kind === 'offer' ? 'Je propose des places' : 'Je cherche une place'}
      onClose={onClose}
      footer={
        <button className="btn primary lg block" disabled={busy || (kind === 'request' && !f.playerId)} onClick={save}>
          {kind === 'offer' ? 'Proposer mon trajet' : 'Envoyer ma demande'}
        </button>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <p className="small muted">
          {cp.title} · {cp.location}
        </p>
        {kind === 'request' && kids.length > 1 && (
          <div className="chips">
            {kids.map((k) => (
              <button key={k.id} className={`chip${f.playerId === k.id ? ' on' : ''}`} onClick={() => setF({ ...f, playerId: k.id })}>
                {k.firstName}
              </button>
            ))}
          </div>
        )}
        <div className="dir-pick">
          {(Object.keys(DIRECTION) as Direction[]).map((d) => (
            <button key={d} className={f.direction === d ? 'on' : ''} onClick={() => setF({ ...f, direction: d })}>
              <span>{d === 'aller' ? '→' : d === 'retour' ? '←' : '⇄'}</span>
              {DIRECTION[d].label}
            </button>
          ))}
        </div>
        {kind === 'offer' && (
          <>
            <div className="seat-pick">
              <span className="small">Places pour les enfants</span>
              <div className="row" style={{ gap: 12 }}>
                <button className="btn icon" onClick={() => setF({ ...f, seats: Math.max(1, f.seats - 1) })} aria-label="Une place de moins">
                  <Minus />
                </button>
                <span className="seats big">
                  {Array.from({ length: f.seats }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <button className="btn icon" onClick={() => setF({ ...f, seats: Math.min(8, f.seats + 1) })} aria-label="Une place de plus">
                  <Plus />
                </button>
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <label className="input-ic grow">
                <MapPin size={16} />
                <input className="input" placeholder="Point de départ (ex. parking du stade)" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
              </label>
              <label className="input-ic" style={{ width: 130 }}>
                <Clock size={16} />
                <input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
              </label>
            </div>
          </>
        )}
        <input className="input" placeholder={kind === 'offer' ? 'Un mot (facultatif) : rehausseur disponible…' : 'Un mot (facultatif) : on habite près de…'} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <label className="check small">
          <input type="checkbox" checked={f.share} onChange={(e) => setF({ ...f, share: e.target.checked })} />
          <span>Annoncer dans la discussion de l’équipe</span>
        </label>
      </div>
    </Sheet>
  );
}

function subtract(time: string, min: number) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.max(0, h * 60 + m - min);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
