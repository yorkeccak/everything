"use client";
import React, { useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { SparklesCore } from "@/components/ui/sparkles";

// Cover: When hovered, all effects disappear and the word looks normal.
export const Cover = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sparklesReady, setSparklesReady] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [beamPositions, setBeamPositions] = useState<number[]>([]);

  useEffect(() => {
    setMounted(true);
    // Add a small delay to ensure SparklesCore is ready
    const timer = setTimeout(() => {
      setSparklesReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ref.current && mounted) {
      setContainerWidth(ref.current?.clientWidth ?? 0);

      const height = ref.current?.clientHeight ?? 0;
      const numberOfBeams = Math.floor(height / 10); // Adjust the divisor to control the spacing
      const positions = Array.from(
        { length: numberOfBeams },
        (_, i) => (i + 1) * (height / (numberOfBeams + 1))
      );
      setBeamPositions(positions);
    }
  }, [ref.current, mounted]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={ref}
      className={cn(
        "relative group/cover inline-block dark:bg-neutral-900 bg-neutral-100 px-2 py-2 transition duration-200 rounded-sm",
        hovered && "bg-transparent"
      )}
    >
      {/* Only show effects when not hovered */}
      {!hovered && (
        <>
          {/* Sparkles */}
          {mounted && sparklesReady && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: {
                  duration: 0.2,
                },
              }}
              className="h-full w-full overflow-hidden absolute inset-0 pointer-events-none"
            >
              <motion.div
                animate={{
                  translateX: ["-50%", "0%"],
                }}
                transition={{
                  translateX: {
                    duration: 10,
                    ease: "linear",
                    repeat: Infinity,
                  },
                }}
                className="w-[200%] h-full flex"
              >
                <SparklesCore
                  background="transparent"
                  minSize={0.4}
                  maxSize={1}
                  particleDensity={500}
                  className="w-full h-full"
                  particleColor="#FFFFFF"
                />
                <SparklesCore
                  background="transparent"
                  minSize={0.4}
                  maxSize={1}
                  particleDensity={500}
                  className="w-full h-full"
                  particleColor="#FFFFFF"
                />
              </motion.div>
            </motion.div>
          )}
          {/* Beams */}
          {beamPositions.map((position, index) => (
            <Beam
              key={index}
              hovered={false}
              duration={Math.random() * 2 + 1}
              delay={Math.random() * 2 + 1}
              width={containerWidth}
              style={{
                top: `${position}px`,
              }}
            />
          ))}
        </>
      )}
      {/* The word itself */}
      {mounted && (
        <span
          className={cn(
            "dark:text-white inline-block text-neutral-900 relative z-20 transition duration-200",
            className,
            hovered && "group-hover/cover:text-inherit"
          )}
        >
          {children}
        </span>
      )}
      {/* Corner icons only when not hovered */}
      {!hovered && (
        <>
          <CircleIcon className="absolute -right-[2px] -top-[2px]" />
          <CircleIcon
            className="absolute -bottom-[2px] -right-[2px]"
            delay={0.4}
          />
          <CircleIcon className="absolute -left-[2px] -top-[2px]" delay={0.8} />
          <CircleIcon
            className="absolute -bottom-[2px] -left-[2px]"
            delay={1.6}
          />
        </>
      )}
    </div>
  );
};

export const Beam = ({
  className,
  delay,
  duration,
  hovered,
  width = 600,
  ...svgProps
}: {
  className?: string;
  delay?: number;
  duration?: number;
  hovered?: boolean;
  width?: number;
} & React.ComponentProps<typeof motion.svg>) => {
  const id = useId();

  // If hovered, don't render anything (hide beams)
  if (hovered) return null;

  return (
    <motion.svg
      width={width ?? "600"}
      height="1"
      viewBox={`0 0 ${width ?? "600"} 1`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("absolute inset-x-0 w-full", className)}
      {...svgProps}
    >
      <motion.path
        d={`M0 0.5H${width ?? "600"}`}
        stroke={`url(#svgGradient-${id})`}
      />

      <defs>
        <motion.linearGradient
          id={`svgGradient-${id}`}
          key={String(hovered)}
          gradientUnits="userSpaceOnUse"
          initial={{
            x1: "0%",
            x2: "-5%",
            y1: 0,
            y2: 0,
          }}
          animate={{
            x1: "110%",
            x2: "105%",
            y1: 0,
            y2: 0,
          }}
          transition={{
            duration: duration ?? 2,
            ease: "linear",
            repeat: Infinity,
            delay: 0,
            repeatDelay: delay ?? 1,
          }}
        >
          <stop stopColor="#2EB9DF" stopOpacity="0" />
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </motion.svg>
  );
};

export const CircleIcon = ({
  className,
  delay,
}: {
  className?: string;
  delay?: number;
}) => {
  return (
    <div
      className={cn(
        `pointer-events-none animate-pulse group h-2 w-2 rounded-full bg-neutral-600 dark:bg-white opacity-20`,
        className
      )}
    ></div>
  );
};
