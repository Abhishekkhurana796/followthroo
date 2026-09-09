/**
 * One place that registers ScrollTrigger.
 *
 * Five marketing components each did `gsap.registerPlugin(ScrollTrigger)` at
 * module scope. registerPlugin is idempotent, so the repetition was harmless at
 * runtime — but it meant five modules each pulling gsap in directly, and no
 * single place to change if the plugin set grows. Importing gsap from here
 * keeps the dependency stated once.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };
export default gsap;
