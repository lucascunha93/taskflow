const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function taskDateBound(value: string, endOfDay: boolean): Date {
  if (dateOnlyPattern.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return new Date(value);
}
