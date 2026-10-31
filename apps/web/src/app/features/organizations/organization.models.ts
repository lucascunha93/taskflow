export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';

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
