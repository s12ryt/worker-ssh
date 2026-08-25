package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

const MaxSftpChunkSize = 512 * 1024

type SftpReadHandle struct {
	mu     sync.Mutex
	client *sftp.Client
	file   *sftp.File
	closed bool
}

type SftpWriteHandle struct {
	mu     sync.Mutex
	client *sftp.Client
	file   *sftp.File
	closed bool
}

// Entry 描述一個遠端檔案系統條目。
type Entry struct {
	Name    string
	Size    int64
	Mode    uint32
	IsDir   bool
	ModTime int64 // Unix 秒
}

// slashPath 將路徑統一為正斜線形式（SFTP 協議與本引擎的契約）。
func slashPath(p string) string {
	return filepath.ToSlash(p)
}

// sftpClientOf 為既有 SSH 連線建立 SFTP 客戶端。
func sftpClientOf(c *gossh.Client) (*sftp.Client, error) {
	cli, err := sftp.NewClient(c)
	if err != nil {
		return nil, fmt.Errorf("建立 SFTP 客戶端失敗：%w", err)
	}
	return cli, nil
}

func entryFromInfo(fi os.FileInfo) Entry {
	return Entry{
		Name:    fi.Name(),
		Size:    fi.Size(),
		Mode:    uint32(fi.Mode()),
		IsDir:   fi.IsDir(),
		ModTime: fi.ModTime().Unix(),
	}
}

// SftpList 列出目錄內容。
func SftpList(c *gossh.Client, path string) ([]Entry, error) {
	cli, err := sftpClientOf(c)
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	infos, err := cli.ReadDir(slashPath(path))
	if err != nil {
		return nil, fmt.Errorf("讀取目錄 %s 失敗：%w", path, err)
	}
	entries := make([]Entry, 0, len(infos))
	for _, fi := range infos {
		entries = append(entries, entryFromInfo(fi))
	}
	return entries, nil
}

// SftpStat 取得單一路徑資訊。
func SftpStat(c *gossh.Client, path string) (*Entry, error) {
	cli, err := sftpClientOf(c)
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	fi, err := cli.Stat(slashPath(path))
	if err != nil {
		return nil, fmt.Errorf("stat %s 失敗：%w", path, err)
	}
	e := entryFromInfo(fi)
	return &e, nil
}

// SftpReadFile 讀取整個檔案。
func SftpReadFile(c *gossh.Client, path string) ([]byte, error) {
	cli, err := sftpClientOf(c)
	if err != nil {
		return nil, err
	}
	defer cli.Close()
	f, err := cli.Open(slashPath(path))
	if err != nil {
		return nil, fmt.Errorf("開啟檔案 %s 失敗：%w", path, err)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("讀取檔案 %s 失敗：%w", path, err)
	}
	return data, nil
}

func SftpOpenRead(c *gossh.Client, path string) (*SftpReadHandle, int64, error) {
	cli, err := sftpClientOf(c)
	if err != nil {
		return nil, 0, err
	}
	f, err := cli.Open(slashPath(path))
	if err != nil {
		cli.Close()
		return nil, 0, fmt.Errorf("開啟檔案 %s 失敗：%w", path, err)
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		cli.Close()
		return nil, 0, fmt.Errorf("stat %s 失敗：%w", path, err)
	}
	return &SftpReadHandle{client: cli, file: f}, info.Size(), nil
}

func (h *SftpReadHandle) ReadChunk(maxBytes int) ([]byte, bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, false, fmt.Errorf("SFTP 讀取控制代碼已關閉")
	}
	if maxBytes < 1 || maxBytes > MaxSftpChunkSize {
		return nil, false, fmt.Errorf("SFTP chunk 大小必須介於 1 與 %d", MaxSftpChunkSize)
	}
	buffer := make([]byte, maxBytes)
	n, err := h.file.Read(buffer)
	if err != nil && err != io.EOF {
		return nil, false, fmt.Errorf("SFTP 分塊讀取失敗：%w", err)
	}
	return buffer[:n], err == io.EOF, nil
}

func (h *SftpReadHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	fileErr := h.file.Close()
	clientErr := h.client.Close()
	if fileErr != nil {
		return fmt.Errorf("關閉 SFTP 讀取檔案失敗：%w", fileErr)
	}
	if clientErr != nil {
		return fmt.Errorf("關閉 SFTP 讀取客戶端失敗：%w", clientErr)
	}
	return nil
}

// SftpWriteFile 寫入（覆蓋）檔案。
func SftpWriteFile(c *gossh.Client, path string, data []byte) error {
	cli, err := sftpClientOf(c)
	if err != nil {
		return err
	}
	defer cli.Close()
	f, err := cli.Create(slashPath(path))
	if err != nil {
		return fmt.Errorf("建立檔案 %s 失敗：%w", path, err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("寫入檔案 %s 失敗：%w", path, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("關閉檔案 %s 失敗：%w", path, err)
	}
	return nil
}

func SftpOpenWrite(c *gossh.Client, path string) (*SftpWriteHandle, error) {
	cli, err := sftpClientOf(c)
	if err != nil {
		return nil, err
	}
	f, err := cli.Create(slashPath(path))
	if err != nil {
		cli.Close()
		return nil, fmt.Errorf("建立檔案 %s 失敗：%w", path, err)
	}
	return &SftpWriteHandle{client: cli, file: f}, nil
}

func (h *SftpWriteHandle) WriteChunk(data []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return fmt.Errorf("SFTP 寫入控制代碼已關閉")
	}
	if len(data) > MaxSftpChunkSize {
		return fmt.Errorf("SFTP chunk 大小不可超過 %d", MaxSftpChunkSize)
	}
	if len(data) == 0 {
		return nil
	}
	if _, err := h.file.Write(data); err != nil {
		return fmt.Errorf("SFTP 分塊寫入失敗：%w", err)
	}
	return nil
}

func (h *SftpWriteHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	fileErr := h.file.Close()
	clientErr := h.client.Close()
	if fileErr != nil {
		return fmt.Errorf("關閉 SFTP 寫入檔案失敗：%w", fileErr)
	}
	if clientErr != nil {
		return fmt.Errorf("關閉 SFTP 寫入客戶端失敗：%w", clientErr)
	}
	return nil
}

// SftpMkdir 建立目錄。
func SftpMkdir(c *gossh.Client, path string) error {
	cli, err := sftpClientOf(c)
	if err != nil {
		return err
	}
	defer cli.Close()
	if err := cli.Mkdir(slashPath(path)); err != nil {
		return fmt.Errorf("建立目錄 %s 失敗：%w", path, err)
	}
	return nil
}

// SftpRemove 刪除檔案或空目錄。
func SftpRemove(c *gossh.Client, path string) error {
	cli, err := sftpClientOf(c)
	if err != nil {
		return err
	}
	defer cli.Close()
	err = cli.Remove(slashPath(path))
	if err == nil {
		return nil
	}
	// 檔案刪除失敗時嘗試以目錄方式刪除（空目錄）
	if rmErr := cli.RemoveDirectory(slashPath(path)); rmErr == nil {
		return nil
	}
	return fmt.Errorf("刪除 %s 失敗：%w", path, err)
}

// SftpRename 重新命名／移動；優先使用 POSIX 語意（可跨目錄）。
func SftpRename(c *gossh.Client, oldPath, newPath string) error {
	cli, err := sftpClientOf(c)
	if err != nil {
		return err
	}
	defer cli.Close()
	if err := cli.PosixRename(slashPath(oldPath), slashPath(newPath)); err == nil {
		return nil
	}
	// server 不支援 posix-rename@openssh.com 時退回標準 rename
	if err := cli.Rename(slashPath(oldPath), slashPath(newPath)); err != nil {
		return fmt.Errorf("重新命名 %s → %s 失敗：%w", oldPath, newPath, err)
	}
	return nil
}
