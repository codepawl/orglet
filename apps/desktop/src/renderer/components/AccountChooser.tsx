import { useState } from 'react';
import { Laptop, LogIn, X } from 'lucide-react';
import type { AccountChoice, AccountState } from '../../shared/account';
import { orglet } from '../api';
import { t } from '../i18n';
import { AnalyticsDisclosure } from './AccountSettings';
import { Orglet3D } from './Orglet3D';
import type { Moment } from './orgletStage';
import { toast } from './toast';
import { Button } from './ui';
import { maskEmail } from '../../shared/pii';
import { holdForSmile } from '../screenTransition';

/*
 * The first-run question (COD-337): a new install asks once whether to sign in to a CodePawl account or to use Orglet
 * without one, before the normal app. One quiet panel, the same monochrome orglet the startup screen shows, a title and
 * one sentence under each choice. Signing in is the filled button; there is no "recommended" label. While the browser
 * is open the panel says so with Cancel; a failure puts a plain reason where the sign-in sentence was, with Try again.
 * The face reacts without words (COD-341): it glances aside when the browser opens and thinks while it waits, winces at
 * a failure, and smiles for a beat once the person has chosen, before the app takes the screen.
 */

const FACE_SIZE = 80;
// The startup screen's orglet, so the face does not change between the two screens.
const FACE_SEED = 29;

type Phase = 'choosing' | 'waiting' | 'failed';
type Cue = { kind: Moment; count: number };

export function AccountChooser({ account, onChoose }: { account: AccountState | undefined; onChoose: (choice: AccountChoice) => Promise<void> }) {
  const [phase, setPhase] = useState<Phase>(account?.status === 'signing_in' ? 'waiting' : 'choosing');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cheer, setCheer] = useState(0);
  const [cue, setCue] = useState<Cue>();
  const play = (kind: Moment) => setCue(previous => ({ kind, count: (previous?.count ?? 0) + 1 }));

  const signIn = async () => {
    setError('');
    setPhase('waiting');
    // The face looks aside, towards the browser that just opened.
    play('glance');
    try {
      const state = await orglet.accountSignIn();
      if (state.status !== 'signed_in') {
        setPhase('choosing');
        return;
      }
      setCheer(count => count + 1);
      await holdForSmile();
      await onChoose('account');
      toast(state.email ? t('Đã đăng nhập bằng {0}', [maskEmail(state.email)]) : t('Đã đăng nhập'), 'success', t('Tài khoản CodePawl'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPhase('failed');
      play('squint');
    }
  };
  const cancel = () => {
    void orglet.accountCancelSignIn().catch(() => undefined);
  };
  const useLocally = async () => {
    setSaving(true);
    setCheer(count => count + 1);
    try {
      await holdForSmile();
      await onChoose('local');
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : String(failure), 'error', t('Tài khoản CodePawl'));
      setSaving(false);
      play('squint');
    }
  };

  const waiting = phase === 'waiting';
  return <div className="account-choice-screen">
    <main className="account-choice" id="main-content" tabIndex={-1} aria-labelledby="account-choice-title">
      <div className="account-choice-body">
        {/* No greeting hop of its own: this is the startup screen's face, which hops over here in the screen transition. */}
        <div className="startup-face" aria-hidden="true">
          <Orglet3D id="classic" seed={FACE_SEED} size={FACE_SIZE} color="mono" motion={{ lead: true, mood: waiting ? 'thinking' : 'idle', cheer, moment: cue }} />
        </div>
        <h1 id="account-choice-title" className="welcome">{waiting ? t('Tiếp tục trong trình duyệt') : t('Chào mừng đến với Orglet')}</h1>
        {waiting ? <div className="account-choice-waiting">
          <p role="status">{t('Đăng nhập ở trang vừa mở, rồi quay lại đây.')}</p>
          <Button variant="outline" onClick={cancel}><X size={16} />{t('Hủy')}</Button>
        </div> : /* Two full-width choices with centred labels of different lengths: their text is meant to start apart. */
        <div className="account-choice-options" data-align-ignore="column-start icon-slot">
          <div className="account-choice-option">
            <Button variant="primary" disabled={saving} onClick={() => void signIn()}><LogIn size={16} />{phase === 'failed' ? t('Thử lại lần nữa') : t('Đăng nhập')}</Button>
            {phase === 'failed'
              ? <p className="error" role="alert">{error}</p>
              : <>
                <p>{t('Một tài khoản CodePawl miễn phí; đồng bộ giữa các máy sẽ có sau.')}</p>
                <p className="account-choice-disclosure"><AnalyticsDisclosure signedIn={false} /></p>
              </>}
          </div>
          <div className="account-choice-option">
            <Button variant="outline" disabled={saving} onClick={() => void useLocally()}><Laptop size={16} />{t('Dùng không cần tài khoản')}</Button>
            <p>{t('Mọi thứ ở lại trên máy này; bạn có thể đăng nhập sau trong Cài đặt.')}</p>
          </div>
        </div>}
      </div>
    </main>
  </div>;
}
