import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderForm } from '../components/ProviderForm';
import { useSettingsStore } from '../stores/settings-store';
import { useSessionStore } from '../stores/session-store';
import { Button, Heading } from '../components/ui';

interface OnboardingPageProps {
  onDone: () => void;
  onSkip: () => void;
}

/**
 * First-launch wizard. Shown when no providers are configured.
 * Step 1: Welcome → Get started
 * Step 2: Add first voice via ProviderForm → land in chat
 */
export function OnboardingPage({ onDone, onSkip }: OnboardingPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const createSession = useSessionStore((s) => s.createSession);

  const handleProviderSubmit = async (config: {
    id: string;
    type: string;
    apiKey: string;
    baseURL?: string;
  }) => {
    await addProvider(config as any);
    await createSession();
    onDone();
  };

  return (
    <div className="h-full flex items-center justify-center bg-paper px-6">
      <div className="w-full max-w-[560px] anim-fade-up">
        {step === 1 && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-[12px] bg-accent text-white text-[24px] font-semibold mb-6">
              s
            </div>
            <Heading level={1} className="mb-3">
              {t('onboarding.welcomeTitle')}
            </Heading>
            <p className="text-[15px] text-ink-muted leading-[1.55] max-w-[420px] mx-auto mb-8">
              {t('onboarding.welcomeBody')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => setStep(2)} variant="primary">
                {t('onboarding.getStarted')}
              </Button>
              <Button onClick={onSkip} variant="link">
                {t('onboarding.skip')}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <Heading level={2} className="mb-2">
              {t('onboarding.addFirstVoiceTitle')}
            </Heading>
            <p className="text-[13px] text-ink-muted mb-2">
              {t('onboarding.addFirstVoiceBody')}
            </p>
            <div className="border border-rule rounded-[10px] bg-surface p-5">
              <ProviderForm
                onSubmit={handleProviderSubmit}
                onCancel={() => setStep(1)}
              />
            </div>
            <div className="mt-3 text-center">
              <Button onClick={onSkip} variant="link">
                {t('onboarding.skip')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
