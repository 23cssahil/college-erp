import 'mongoose';

/**
 * Mongoose supports the `as` populate option at runtime (rename the populated
 * field in the output — we use it to expose a stored `courseId` ref as a
 * `course` object, mirroring the old Prisma `include` shape), but its type
 * declarations omit it. Augment the interface so every `.populate({ path, as })`
 * call type-checks.
 */
declare module 'mongoose' {
  interface PopulateOptions {
    as?: string;
  }
}
