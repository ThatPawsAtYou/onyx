import React, { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { cn } from '../lib/format';

interface BentoCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const BentoCard: React.FC<BentoCardProps> = React.memo(
  ({ children, className, delay = 0 }) => {
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const rectRef = useRef<{ left: number; top: number } | null>(null);

    function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>) {
      const r = e.currentTarget.getBoundingClientRect();
      rectRef.current = { left: r.left, top: r.top };
    }

    function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
      if (!rectRef.current) {
        const r = e.currentTarget.getBoundingClientRect();
        rectRef.current = { left: r.left, top: r.top };
      }
      mouseX.set(e.clientX - rectRef.current.left);
      mouseY.set(e.clientY - rectRef.current.top);
    }

    const spotlight = useMotionTemplate`radial-gradient(520px circle at ${mouseX}px ${mouseY}px, rgba(255, 255, 255, 0.055), transparent 65%)`;

    return (
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.992 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          type: 'spring',
          stiffness: 380,
          damping: 32,
          delay,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        className={cn(
          'group relative overflow-hidden rounded-[22px] bg-[#0A0A0D]/95 border border-white/10 shadow-bento transition-colors duration-300 hover:border-white/[0.16]',
          className
        )}
      >
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px rounded-[22px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: spotlight }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
        />

        <div className="relative z-10 flex h-full flex-col">{children}</div>
      </motion.section>
    );
  }
);
BentoCard.displayName = 'BentoCard';
