const leadVerbsZh = /主导|带头|你来主答|先回答|你先/;
const leadVerbsEn = /\blead\b|\btake the lead\b|\byou first\b|\byou go first\b|\byou answer first\b/i;
const commentVerbsZh = /点评|评价|补充|跟进/;
const commentVerbsEn = /\bcomment\b|\bfollow up\b|\badd to\b/i;

export function scanLead(text: string): boolean {
  return leadVerbsZh.test(text) || leadVerbsEn.test(text);
}
export function scanComment(text: string): boolean {
  return commentVerbsZh.test(text) || commentVerbsEn.test(text);
}
