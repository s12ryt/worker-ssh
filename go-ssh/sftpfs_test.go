package main

import (
	"bytes"
	"path/filepath"
	"sort"
	"testing"
)

// 契約：SftpMkdir 建立目錄後，SftpList 可見且 IsDir=true。
func TestSftpMkdirAndList(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	dir := filepath.Join(ts.rootDir, "subdir")
	if err := SftpMkdir(c, dir); err != nil {
		t.Fatalf("SftpMkdir 失敗：%v", err)
	}

	entries, err := SftpList(c, ts.rootDir)
	if err != nil {
		t.Fatalf("SftpList 失敗：%v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("應有 1 個條目，得到 %d：%+v", len(entries), entries)
	}
	if entries[0].Name != "subdir" || !entries[0].IsDir {
		t.Errorf("條目 = %+v，想要 {Name:subdir IsDir:true}", entries[0])
	}
}

// 契約：SftpWriteFile → SftpReadFile 往返一致；List 顯示檔案大小。
func TestSftpWriteReadRoundtrip(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	path := filepath.Join(ts.rootDir, "hello.txt")
	data := []byte("你好，SFTP 世界！")
	if err := SftpWriteFile(c, path, data); err != nil {
		t.Fatalf("SftpWriteFile 失敗：%v", err)
	}

	got, err := SftpReadFile(c, path)
	if err != nil {
		t.Fatalf("SftpReadFile 失敗：%v", err)
	}
	if string(got) != string(data) {
		t.Errorf("往返不一致：got %q want %q", got, data)
	}

	entries, err := SftpList(c, ts.rootDir)
	if err != nil {
		t.Fatalf("SftpList 失敗：%v", err)
	}
	if len(entries) != 1 || entries[0].Name != "hello.txt" {
		t.Fatalf("List 應含 hello.txt，得到 %+v", entries)
	}
	if entries[0].Size != int64(len(data)) {
		t.Errorf("Size = %d，想要 %d", entries[0].Size, len(data))
	}
	if entries[0].IsDir {
		t.Error("hello.txt 不應是目錄")
	}
}

// 契約：SftpStat 回傳單一條目資訊。
func TestSftpStat(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	path := filepath.Join(ts.rootDir, "stat-me.txt")
	if err := SftpWriteFile(c, path, []byte("12345")); err != nil {
		t.Fatalf("寫入失敗：%v", err)
	}
	e, err := SftpStat(c, path)
	if err != nil {
		t.Fatalf("SftpStat 失敗：%v", err)
	}
	if e.Name != "stat-me.txt" || e.Size != 5 || e.IsDir {
		t.Errorf("Stat = %+v，想要 Name=stat-me.txt Size=5 IsDir=false", e)
	}
}

// 契約：SftpRemove 刪除檔案後 Stat 應回錯誤。
func TestSftpRemove(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	path := filepath.Join(ts.rootDir, "doomed.txt")
	if err := SftpWriteFile(c, path, []byte("x")); err != nil {
		t.Fatalf("寫入失敗：%v", err)
	}
	if err := SftpRemove(c, path); err != nil {
		t.Fatalf("SftpRemove 失敗：%v", err)
	}
	if _, err := SftpStat(c, path); err == nil {
		t.Fatal("刪除後 Stat 應失敗")
	}
}

// 契約：SftpRename 改名後舊名消失、新名存在。
func TestSftpRename(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	oldPath := filepath.Join(ts.rootDir, "old.txt")
	newPath := filepath.Join(ts.rootDir, "new.txt")
	if err := SftpWriteFile(c, oldPath, []byte("move me")); err != nil {
		t.Fatalf("寫入失敗：%v", err)
	}
	if err := SftpRename(c, oldPath, newPath); err != nil {
		t.Fatalf("SftpRename 失敗：%v", err)
	}
	if _, err := SftpStat(c, oldPath); err == nil {
		t.Error("舊路徑不應存在")
	}
	if _, err := SftpStat(c, newPath); err != nil {
		t.Errorf("新路徑應存在：%v", err)
	}
}

// 契約：List 多條目時名稱齊全（排序後比對）。
func TestSftpListMultipleEntries(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	if err := SftpMkdir(c, filepath.Join(ts.rootDir, "dir-a")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"b.txt", "a.txt", "c.txt"} {
		if err := SftpWriteFile(c, filepath.Join(ts.rootDir, name), []byte(name)); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := SftpList(c, ts.rootDir)
	if err != nil {
		t.Fatalf("SftpList 失敗：%v", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name)
	}
	sort.Strings(names)
	want := []string{"a.txt", "b.txt", "c.txt", "dir-a"}
	if len(names) != len(want) {
		t.Fatalf("條目數 = %d (%v)，想要 %v", len(names), names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("names[%d] = %q，想要 %q", i, names[i], want[i])
		}
	}
}

// 契約：大型檔案使用有界 chunk 串流寫入與讀取，不需整檔載入 Go WASM 記憶體。
func TestSftpChunkedReadWrite(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	path := filepath.Join(ts.rootDir, "chunked.bin")
	want := bytes.Repeat([]byte{0x5a}, 512*1024+17)

	writer, err := SftpOpenWrite(c, path)
	if err != nil {
		t.Fatalf("SftpOpenWrite 失敗：%v", err)
	}
	if err := writer.WriteChunk(want[:512*1024]); err != nil {
		t.Fatalf("第一塊寫入失敗：%v", err)
	}
	if err := writer.WriteChunk(want[512*1024:]); err != nil {
		t.Fatalf("第二塊寫入失敗：%v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("關閉寫入控制代碼失敗：%v", err)
	}

	reader, size, err := SftpOpenRead(c, path)
	if err != nil {
		t.Fatalf("SftpOpenRead 失敗：%v", err)
	}
	if size != int64(len(want)) {
		t.Fatalf("size = %d，想要 %d", size, len(want))
	}
	var got []byte
	for {
		chunk, eof, readErr := reader.ReadChunk(512 * 1024)
		if readErr != nil {
			t.Fatalf("ReadChunk 失敗：%v", readErr)
		}
		if len(chunk) > 512*1024 {
			t.Fatalf("chunk 過大：%d", len(chunk))
		}
		got = append(got, chunk...)
		if eof {
			break
		}
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("關閉讀取控制代碼失敗：%v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("分塊往返不一致：got=%d want=%d", len(got), len(want))
	}
}

func TestSftpReadChunkRejectsInvalidSize(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	path := filepath.Join(ts.rootDir, "invalid-chunk.txt")
	if err := SftpWriteFile(c, path, []byte("ok")); err != nil {
		t.Fatal(err)
	}
	reader, _, err := SftpOpenRead(c, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if _, _, err := reader.ReadChunk(0); err == nil {
		t.Fatal("chunk size 0 應被拒絕")
	}
}
