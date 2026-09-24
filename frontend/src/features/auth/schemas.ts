import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email, like name@company.com."),
  password: z.string().min(1, "Enter your password."),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email, like name@company.com."),
});
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
