import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
export async function parseSkillMd(skillMdPath) {
    const raw = await fs.readFile(skillMdPath, 'utf-8');
    const { data, content } = matter(raw);
    return {
        frontmatter: data,
        content: content.trim(),
        rawContent: raw,
    };
}
export async function listSkillFiles(skillDir) {
    try {
        const entries = await fs.readdir(skillDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isFile())
            .map((e) => e.name);
    }
    catch {
        return [];
    }
}
export function getSkillMdPath(skillDir) {
    return path.join(skillDir, 'SKILL.md');
}
