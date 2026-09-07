import { markdownToWhatsApp } from './textUtils.js';

const input = `That is a wonderful goal! Both careers allow you to shape minds and make a lasting impact, but the daily reality of a **school teacher** versus a **university professor** are very different.

---

### 1. The School Teacher

**Focus:** Teaching *people* how to learn, grow, and navigate the world.

* **Who you teach:** Children or teenagers (ages 5-18).
* **Education required:** Usually a Bachelor's degree plus a state teaching certification. (Takes about 4-5 years).
* **The vibe:** Energetic, nurturing, fast-paced, and highly focused on **human development**.

---

### 2. The College/University Professor

**Focus:** Deep mastery of a *subject* and expanding the boundaries of knowledge.

* **Who you teach:** Adults (ages 18+), from undergraduates to graduate students.
* **Education required:** Usually a Master's degree or a **Ph.D./Doctorate**. This takes 8-12 years.

---

### How to Choose: Ask Yourself These Questions

| Question | Teacher | Professor |
| :--- | :--- | :--- |
| **What excites you more?** | Helping a child grow as a person. | Diving deep into one academic subject. |
| **How long in school?** | Start working in ~4 years. | 8+ years of study. |

---

### A Good Next Step
1. **What subject(s) are you most interested in?**
2. **What stage of your own education are you in right now?**`;

const output = markdownToWhatsApp(input);
console.log('=== CONVERTED OUTPUT ===\n');
console.log(output);
