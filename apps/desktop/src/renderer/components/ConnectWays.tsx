import { CircleCheck, Cpu, KeyRound, TerminalSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n';

/** One way to give an orglet a model, with the connections of that kind that can run right now. */
export type ConnectWay = {
  id: 'plan' | 'key' | 'local';
  /** Names of the connections of this kind that are ready, such as "Claude Code". */
  ready: readonly string[];
  onPick: () => void;
};

const icons: Record<ConnectWay['id'], ReactNode> = {
  plan: <TerminalSquare size={18} aria-hidden="true" />,
  key: <KeyRound size={18} aria-hidden="true" />,
  local: <Cpu size={18} aria-hidden="true" />,
};

function wayText(id: ConnectWay['id']): { title: string; detail: string } {
  if (id === 'plan') return { title: t('Dùng gói bạn đang trả'), detail: t('Claude Code, Codex, Cursor Agent hoặc Gemini CLI đã đăng nhập trên máy này. Không thêm hóa đơn API.') };
  if (id === 'key') return { title: t('Nhập API key'), detail: t('OpenAI, Anthropic, Grok, OpenRouter hoặc một máy chủ tương thích OpenAI. Trả theo lượng dùng, có giới hạn bạn đặt.') };
  return { title: t('Chạy model trên máy này'), detail: t('Ollama đang chạy trên máy. Không gửi gì ra ngoài.') };
}

/**
 * The first thing a profile with no model sees in its orglet's chat (owner, 2026-10-05: no Demo, a real model): the
 * three ways to give the orglet a model, each one a step away. A way whose connection can already run says which one,
 * with a tick, and picking it opens the orglet's Model field; any other opens Settings where that connection is set up.
 */
export function ConnectWays({ orgletName, ways }: { orgletName: string; ways: readonly ConnectWay[] }) {
  return <section className="connect-ways" aria-labelledby="connect-ways-title">
    <h2 id="connect-ways-title">{t('Chọn model cho {0} để bắt đầu', [orgletName])}</h2>
    <ul>
      {ways.map(way => {
        const { title, detail } = wayText(way.id);
        return <li key={way.id}>
          <button type="button" className="connect-way" onClick={way.onPick}>
            <span className="connect-way-icon">{icons[way.id]}</span>
            <span className="connect-way-text">
              <span className="connect-way-title">{title}</span>
              <span className="connect-way-detail">{detail}</span>
              {way.ready.length > 0 && <span className="connect-way-ready"><CircleCheck size={14} aria-hidden="true" />{t('Sẵn sàng: {0}', [way.ready.join(', ')])}</span>}
            </span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
