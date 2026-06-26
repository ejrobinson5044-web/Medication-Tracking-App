import type { Medication } from './types';
import { TIME_OF_DAY_CLOCK, TIME_OF_DAY_LABELS } from './types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(hour)}${pad(minute)}00`;
}

function escapeText(text: string): string {
  return text.replace(/\/g, '\\').replace(/;/g, '\;').replace(/,/g, '\,').replace(/\n/g, '\\n');
}

function formatUtcDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push(line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join('\r\n ');
}

export function generateIcs(meds: Medication[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Medication Tracker//EN',
    'CALSCALE:GREGORIAN',
  ];

  const startDate = new Date();
  const dtStamp = formatUtcDateTime(new Date());

  for (const med of meds) {
    for (const tod of med.timesOfDay) {
      const clock = TIME_OF_DAY_CLOCK[tod];
      if (!clock) continue;

      const { hour, minute } = clock;
      const uid = `${med.id}-${tod}@medication-tracker`;
      const dtStart = formatLocalDateTime(startDate, hour, minute);
      const summary = escapeText(`Take ${med.name}${med.brandOrCommonName ? ` (${med.brandOrCommonName})` : ''}`);
      const descriptionParts = [
        `Amount: ${med.amount}`,
        `Frequency: ${med.frequency}`,
        `Time of day: ${TIME_OF_DAY_LABELS[tod]}`,
      ];
      if (med.notes) descriptionParts.push(`Notes: ${med.notes}`);
      const description = escapeText(descriptionParts.join('\n'));

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtStart}`,
        'RRULE:FREQ=DAILY',
        foldLine(`SUMMARY:${summary}`),
        foldLine(`DESCRIPTION:${description}`),
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        foldLine(`DESCRIPTION:${summary}`),
        'TRIGGER:-PT0M',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(content: string, filename = 'medication-schedule.ics'): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
