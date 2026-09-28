/**
 * Formats a message ISO timestamp into a user-friendly display string.
 * Uses the server's createdAt value.
 *
 * Today -> "10:30 AM"
 * Yesterday -> "Yesterday 10:30 AM"
 * Older -> "MMM D, 10:30 AM"
 */
export const formatMessageTime = (isoString?: string | null): string => {
  if (!isoString) return '';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
  const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;

  if (isToday) {
    return timeString;
  }

  if (isYesterday) {
    return `Yesterday ${timeString}`;
  }

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${timeString}`;
};

/**
 * Formats last seen timestamp.
 */
export const formatLastSeen = (isoString?: string | null): string => {
  if (!isoString) return 'Offline';
  return `Last seen ${formatMessageTime(isoString)}`;
};
