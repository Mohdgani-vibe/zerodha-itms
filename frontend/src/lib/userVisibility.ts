interface ProbeLikeUser {
  fullName?: string | null;
  email?: string | null;
  employeeCode?: string | null;
}

export function isProbeLikeUser(user: ProbeLikeUser) {
  const haystack = [user.fullName || '', user.email || '', user.employeeCode || '']
    .join(' ')
    .toLowerCase();

  return haystack.includes('probe') || haystack.includes('smoke');
}