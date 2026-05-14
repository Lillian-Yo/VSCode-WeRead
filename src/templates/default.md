---
isbn: {{isbn}}
category: {{category}}
author: {{author}}
cover: {{cover}}
progress: {{progress}}%
lastReadTime: {{lastReadTime}}
---

# {{title}}

## 书籍信息
- **作者**: {{author}}
- **出版社**: {{publisher}}
- **ISBN**: {{isbn}}
- **阅读进度**: {{progress}}%

## 读书笔记

{% for chapter in chapters %}
### {{chapter.title}}

{% for note in chapter.notes %}
> {{note.highlightText}}

{% if note.thoughtText %}
💭 {{note.thoughtText}}
{% endif %}

{% endfor %}
{% endfor %}

## 书评

{{bookReview}}
