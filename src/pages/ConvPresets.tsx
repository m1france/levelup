import { Megaphone, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConvSettingsEditor, TimelinePreview, sampleDate } from '../components/ConvSettings';
import { TeamBadge } from '../components/Layout';
import { Empty, Field, Sheet, Spinner, useAsync, useConfirm, useToast } from '../components/ui';
import { api, uid } from '../lib/api';
import { DEFAULT_SETTINGS, timelineOf } from '../lib/convocations';

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
import { useApp } from '../lib/store';
import type { ConvPreset } from '../lib/types';

/** Réglages de convocation prédéfinis : pour le club et par équipe, un par défaut. */
export function ConvPresets() {
  const { me, can, isAdmin } = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const q = useAsync(() => api.get<{ presets: ConvPreset[] }>('/conv-presets'), []);
  const [edit, setEdit] = useState<ConvPreset | null>(null);
  if (q.loading && !q.data) return <Spinner fill />;
  const presets = q.data?.presets ?? [];
  const clubEditable = isAdmin || can('teams.manage');
  const scopes: { id: string | null; label: string; team?: (typeof me.teams)[number]; editable: boolean }[] = [
    { id: null, label: 'Tout le club', editable: clubEditable },
    ...me.teams.map((t) => ({ id: t.id, label: t.category, team: t, editable: true })),
  ];
  const sample = sampleDate();

  const makeDefault = async (p: ConvPreset) => {
    await api.put(`/conv-presets/${p.id}`, { ...p, isDefault: true });
    q.reload();
  };
  const remove = async (p: ConvPreset) => {
    if (!(await confirm({ title: `Supprimer « ${p.name} » ?`, text: 'Les matchs qui l’utilisent reprendront le réglage par défaut.', confirm: 'Supprimer', danger: true }))) return;
    try {
      await api.del(`/conv-presets/${p.id}`);
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="stack" style={{ gap: 26 }}>
      <div className="push-card" style={{ background: 'var(--accent-soft)' }}>
        <span className="push-ic">
          <Megaphone />
        </span>
        <div className="grow">
          <b>Plus jamais de convocation la veille au soir</b>
          <p>
            Chaque match suit un calendrier : disponibilités demandées aux parents, relances automatiques, puis une date limite de publication.
            L’éducateur est alerté avant l’échéance et, si elle est dépassée, les responsables du club sont prévenus.
          </p>
        </div>
      </div>
      {scopes.map((sc) => {
        const list = presets.filter((p) => (p.teamId ?? null) === sc.id);
        return (
          <section key={sc.id ?? 'club'}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                {sc.team && <TeamBadge team={sc.team} size={30} brand={false} />}
                <h3>{sc.label}</h3>
              </div>
              {sc.editable && (
                <button
                  className="btn sm"
                  onClick={() => setEdit({ id: uid(), teamId: sc.id, name: '', isDefault: !list.length, settings: list[0]?.settings ?? DEFAULT_SETTINGS })}
                >
                  <Plus /> Nouveau réglage
                </button>
              )}
            </div>
            {list.length ? (
              <div className="preset-grid">
                {list.map((p) => {
                  const t = timelineOf({ allDay: false, time: '10:00' }, sample, p.settings);
                  return (
                    <div key={p.id} className="card preset">
                      <div className="row between" style={{ gap: 8 }}>
                        <b className="ellipsis">{p.name}</b>
                        {p.isDefault ? (
                          <span className="badge green">
                            <Star /> Par défaut
                          </span>
                        ) : (
                          sc.editable && (
                            <button className="btn sm ghost" onClick={() => makeDefault(p)}>
                              <Star /> Par défaut
                            </button>
                          )
                        )}
                      </div>
                      <ul className="preset-facts">
                        {t.request && (
                          <li>
                            Dispos demandées le {WEEKDAYS[new Date(t.request).getDay()]} (J-{p.settings.request.days}) à {p.settings.request.time.replace(':', 'h')}
                          </li>
                        )}
                        {p.settings.reminders.length > 0 && <li>{p.settings.reminders.length} relance{p.settings.reminders.length > 1 ? 's' : ''} automatique{p.settings.reminders.length > 1 ? 's' : ''}</li>}
                        <li>
                          Convocation au plus tard <b>J-{p.settings.deadline.days} à {p.settings.deadline.time.replace(':', 'h')}</b>
                        </li>
                        <li>
                          {p.settings.squad} convoqués · {p.settings.onField} sur le terrain · {p.settings.periods} × {p.settings.periodMinutes} min
                        </li>
                      </ul>
                      <TimelinePreview settings={p.settings} date={sample} time="10:00" />
                      {sc.editable && (
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          <button className="btn sm" onClick={() => setEdit(p)}>
                            <Pencil /> Modifier
                          </button>
                          <button className="btn sm ghost danger icon" onClick={() => remove(p)} aria-label="Supprimer">
                            <Trash2 />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card">
                <Empty title={sc.id ? 'Réglages du club utilisés' : 'Aucun réglage'} text={sc.id ? 'Créez un réglage propre à cette équipe (format de jeu, délais différents).' : undefined} />
              </div>
            )}
          </section>
        );
      })}
      {edit && <PresetSheet preset={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), q.reload())} />}
    </div>
  );
}

function PresetSheet({ preset, onClose, onSaved }: { preset: ConvPreset; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [p, setP] = useState(preset);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/conv-presets/${p.id}`, { ...p, name: p.name || 'Réglage' });
      toast('Réglage enregistré');
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      wide
      title={preset.name ? `Modifier « ${preset.name} »` : 'Nouveau réglage'}
      onClose={onClose}
      footer={
        <>
          <label className="check small grow">
            <input type="checkbox" checked={p.isDefault} onChange={(e) => setP({ ...p, isDefault: e.target.checked })} />
            <span>Réglage par défaut {p.teamId ? 'de l’équipe' : 'du club'}</span>
          </label>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <Field label="Nom">
          <input className="input" autoFocus value={p.name} placeholder="Ex. : Match du samedi, Plateau U7…" onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <ConvSettingsEditor value={p.settings} onChange={(settings) => setP({ ...p, settings })} />
      </div>
    </Sheet>
  );
}
