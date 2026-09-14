import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/project-store';
import { ProjectWizard } from '../components/ProjectWizard';
import { MountList } from '../components/MountList';

export function ProjectsPage() {
  const { t } = useTranslation();
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const init = useProjectStore((s) => s.init);
  const selectProject = useProjectStore((s) => s.selectProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const active = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-rule bg-surface-2 p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-medium">{t('projects.title')}</h2>
          <button
            onClick={() => setWizardOpen(true)}
            className="text-[12px] px-2 py-1 rounded bg-accent text-white"
          >
            {t('projects.newProject')}
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="text-[12px] text-ink-faint">{t('projects.emptyHint')}</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => void selectProject(p.id)}
                  className={`w-full text-left px-2 py-1 rounded text-[13px] ${
                    p.id === activeProjectId
                      ? 'bg-accent-muted text-accent'
                      : 'hover:bg-surface'
                  }`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">
        {active ? (
          <div className="space-y-4 max-w-2xl">
            <header className="flex items-center justify-between">
              <h1 className="text-xl font-semibold">{active.name}</h1>
              <button
                onClick={() => {
                  if (confirm(t('projects.confirmDelete'))) void deleteProject(active.id);
                }}
                className="text-[12px] text-ink-muted hover:text-danger"
              >
                {t('projects.delete')}
              </button>
            </header>
            <section>
              <h3 className="text-[13px] font-medium mb-2">{t('projects.mountsHeading')}</h3>
              <MountList projectId={active.id} />
            </section>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 max-w-sm mx-auto">
            <div className="w-14 h-14 rounded-[14px] bg-accent-muted flex items-center justify-center text-2xl">
              🗂️
            </div>
            <h2 className="text-[15px] font-semibold text-ink">{t('projects.emptyTitle')}</h2>
            <p className="text-[13px] leading-[1.6] text-ink-muted">{t('projects.emptyBody')}</p>
            <button
              onClick={() => setWizardOpen(true)}
              className="mt-1 h-8 px-4 text-[13px] font-medium text-white bg-accent hover:bg-accent-hover rounded-[8px] transition-colors"
            >
              {t('projects.emptyCta')}
            </button>
          </div>
        )}
      </main>
      {wizardOpen && (
        <ProjectWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => void selectProject(id)}
        />
      )}
    </div>
  );
}
