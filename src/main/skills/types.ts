export interface SkillManifest {
  name: string;
  description?: string;
  system_prompt_addendum?: string;
  recommended_tools?: string[];
}

export interface SkillRecord {
  id: string;
  name: string;
  description?: string;
  manifest: SkillManifest;
  body: string;
  source: 'bundled' | 'user';
  enabled: boolean;
  createdAt: number;
}
