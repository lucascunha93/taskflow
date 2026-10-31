import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const matchingPasswords: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmation')?.value;
  return password === confirmation ? null : { passwordMismatch: true };
};
