// Small line icons (stroke = currentColor) used instead of emoji so they match the text colour.
const PATHS = {
  coin: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></>,
  gift: <><rect x="3.5" y="8.5" width="17" height="4" rx="1" /><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5c-1.5-3.5-5.5-4-5.5-1.5 0 1.5 2.5 1.5 5.5 1.5Zm0 0c1.5-3.5 5.5-4 5.5-1.5 0 1.5-2.5 1.5-5.5 1.5Z" /></>,
  trophy: <path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0v-4ZM7.5 6H4.5v1.5A3 3 0 0 0 7.5 10.5M16.5 6h3v1.5a3 3 0 0 1-3 3M12 13v3.5M8.5 19.5h7M10 16.5h4v3h-4z" />,
  volume: <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3zM16 9.5l5 5M21 9.5l-5 5" />,
  warning: <path d="M12 4 21 19.5H3L12 4ZM12 10v4.5M12 17v.5" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <path d="M3 3l18 18M10.5 6c.5-.1 1-.5 1.5-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.4M6.5 7.5A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 5.5a3 3 0 0 1 0 6M18 14.5c2 .7 3.2 2.4 3.5 5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5 16 10" /></>,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  box: <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4zM3.5 7.5 12 11.5l8.5-4M12 11.5v9" />,
};

export function Icon({ name, size = '1em', className = '', title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ verticalAlign: '-0.15em', flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
