# mmd2drawio

แปลง [Mermaid](https://mermaid.js.org/) เป็นไฟล์ HTML หรือ SVG สไตล์การ์ดโค้งมนในคำสั่งเดียว จัดตำแหน่งกล่องด้วย [Pele](https://www.npmjs.com/package/pele) แล้ววาดใหม่ด้วยฟอนต์ Anuphan พื้นสว่าง มุมโค้ง เงาแข็ง สีตามบทบาท

เขียนแค่ Mermaid สั้นๆ ไม่ต้องจัดตำแหน่งหรือเขียน SVG เอง

## ติดตั้ง

```bash
npm install
```

ต้องมี Node.js 18 ขึ้นไป `--png` ต้องมี Chrome หรือ Chromium

## ใช้

```bash
node bin/mmd2drawio.mjs flow.mmd -o out
node bin/mmd2drawio.mjs flow.mmd -o out --svg            # SVG ล้วน
node bin/mmd2drawio.mjs flow.mmd -o out --square --png   # การ์ดจตุรัสสำหรับโพสต์
node bin/mmd2drawio.mjs docs.md -o out                   # หลายบล็อก mermaid ในไฟล์ .md ได้หน้าละภาพ
```

รองรับ `flowchart`, `stateDiagram`, `sequenceDiagram`, `erDiagram`, `classDiagram` และ `xychart` ตัวเลือกทั้งหมดดูใน [SKILL.md](SKILL.md) หรือรัน `--help`

## ทดสอบ

```bash
npm test
```

## ใช้เป็นสกิลของ AI

โฟลเดอร์นี้เป็นสกิลด้วย ให้คัดลอกไปไว้ที่ `~/.claude/skills/mmd2drawio` แล้วบอก AI ว่า "ทำไดอะแกรม..." ดูไฟล์ [SKILL.md](SKILL.md)
