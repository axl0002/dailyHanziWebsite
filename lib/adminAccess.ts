/** Revenue-derived reports require admin access in middleware and navigation. */
export function isAdminOnlyPath(pathname: string): boolean {
  return ["/admin/dashboard", "/admin/north-star"].some(
    (path) => pathname === path || pathname.startsWith(path + "/"),
  );
}
