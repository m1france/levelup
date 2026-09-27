import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';

/**
 * Les annonces sont désormais un salon de la messagerie (lecture seule pour les parents) :
 * les anciens liens (/annonces, /annonces/:id, notifications) ouvrent ce salon.
 */
export function Announcements() {
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    api
      .get<{ threadId: string | null }>('/chat/announce')
      .then((r) => nav(r.threadId ? `/messages/${r.threadId}` : '/messages', { replace: true }))
      .catch((e) => {
        toast((e as Error).message, true);
        nav('/messages', { replace: true });
      });
  }, [nav, toast]);
  return <Spinner fill />;
}

export const AnnouncementPage = Announcements;
