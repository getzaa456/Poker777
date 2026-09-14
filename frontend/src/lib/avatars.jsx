import React from 'react';

const avatarMarkup = {
  1: (maskId) => `<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true"><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36"><rect width="36" height="36" rx="72" fill="#fff"/></mask><g mask="url(#${maskId})"><rect width="36" height="36" fill="#ff005b"/><rect x="0" y="0" width="36" height="36" transform="translate(9 -5) rotate(219 18 18) scale(1)" fill="#ffb238" rx="6"/><g transform="translate(4.5 -4) rotate(9 18 18)"><path d="M15 19c2 1 4 1 6 0" stroke="#000" fill="none" stroke-linecap="round"/><rect x="10" y="14" width="1.5" height="2" rx="1" fill="#000"/><rect x="24" y="14" width="1.5" height="2" rx="1" fill="#000"/></g></g></svg>`,
  2: (maskId) => `<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true"><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36"><rect width="36" height="36" rx="72" fill="#fff"/></mask><g mask="url(#${maskId})"><rect width="36" height="36" fill="#ff7d10"/><rect x="0" y="0" width="36" height="36" transform="translate(5 -1) rotate(55 18 18) scale(1.1)" fill="#0a0310" rx="6"/><g transform="translate(7 -6) rotate(-5 18 18)"><path d="M15 20c2 1 4 1 6 0" stroke="#fff" fill="none" stroke-linecap="round"/><rect x="14" y="14" width="1.5" height="2" rx="1" fill="#fff"/><rect x="20" y="14" width="1.5" height="2" rx="1" fill="#fff"/></g></g></svg>`,
  3: (maskId) => `<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true"><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36"><rect width="36" height="36" rx="72" fill="#fff"/></mask><g mask="url(#${maskId})"><rect width="36" height="36" fill="#0a0310"/><rect x="0" y="0" width="36" height="36" transform="translate(-3 7) rotate(227 18 18) scale(1.2)" fill="#ff005b" rx="36"/><g transform="translate(-3 3.5) rotate(7 18 18)"><path d="M13,21 a1,0.75 0 0,0 10,0" fill="#fff"/><rect x="12" y="14" width="1.5" height="2" rx="1" fill="#fff"/><rect x="22" y="14" width="1.5" height="2" rx="1" fill="#fff"/></g></g></svg>`,
  4: (maskId) => `<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true"><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36"><rect width="36" height="36" rx="72" fill="#fff"/></mask><g mask="url(#${maskId})"><rect width="36" height="36" fill="#d8fcb3"/><rect x="0" y="0" width="36" height="36" transform="translate(9 -5) rotate(219 18 18) scale(1)" fill="#89fcb3" rx="6"/><g transform="translate(4.5 -4) rotate(9 18 18)"><path d="M15 19c2 1 4 1 6 0" stroke="#000" fill="none" stroke-linecap="round"/><rect x="10" y="14" width="1.5" height="2" rx="1" fill="#000"/><rect x="24" y="14" width="1.5" height="2" rx="1" fill="#000"/></g></g></svg>`,
};

export const avatarIds = [1, 2, 3, 4];

export function normalizeAvatarId(value) {
  const id = Number.parseInt(value, 10);
  return avatarMarkup[id] ? id : 1;
}

export function AvatarFace({ id = 1, prefix = 'avatar', className = '' }) {
  const avatarId = normalizeAvatarId(id);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: avatarMarkup[avatarId](`${prefix}-${avatarId}`) }}
    />
  );
}
