import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const trimmedName: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value: unknown = control.value;
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120
    ? null
    : { nameLength: true };
};

export const matchingPasswords: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmation')?.value;
  return password === confirmation ? null : { passwordMismatch: true };
};
