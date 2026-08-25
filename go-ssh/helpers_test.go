package main

import (
	"net"
	"strconv"
)

// hostOf / portOf 從測試伺服器位址拆出主機與埠。
func hostOf(addr string) string {
	h, _, err := net.SplitHostPort(addr)
	if err != nil {
		panic("無法解析位址：" + addr)
	}
	return h
}

func portOf(addr string) int {
	_, p, err := net.SplitHostPort(addr)
	if err != nil {
		panic("無法解析位址：" + addr)
	}
	n, err := strconv.Atoi(p)
	if err != nil {
		panic("無法解析埠：" + addr)
	}
	return n
}
