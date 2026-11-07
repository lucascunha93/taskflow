export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const ROLE_LABELS: Readonly<Record<OrganizationRole, string>> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
};

/** Papéis que a API autoriza a alterar dados da organização e adicionar membros. */
export const canManageOrganization = (role: OrganizationRole): boolean => role === 'OWNER' || role === 'ADMIN';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  role: OrganizationRole;
}

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberships: { role: OrganizationRole }[];
}
