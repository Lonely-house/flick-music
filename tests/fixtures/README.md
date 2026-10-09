# 测试素材

`tone.mp3` 是本次自动化测试专门生成的 60 秒 / 440 Hz 合成正弦音，非用户上传歌曲；用于真实 HTML5 Audio MP3 上传、播放、seek 和跨会话接力验证。

生成命令（复用已打包素材时不需要 ffmpeg）：

```bash
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=60 -c:a libmp3lame -b:a 32k tone.mp3
```

其他 WAV 素材由 tests/helpers.js 在内存中合成。测试数据库、Cookie、文件仓库均使用临时目录，结束后清理。

`v1-registration.js` 仅保留 V1 角色排他与本地 Audio Ready 决策，供 legacy.test.js 复现历史 Bug；V2 运行时不引用它。完整旧测试源位于 docs/V1\_\*\_TESTS_REFERENCE.txt，历史测试报告见 docs/V1_TEST_RESULTS.md。
