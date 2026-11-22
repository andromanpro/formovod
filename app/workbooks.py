"""Read model-requested pages of Excel workbooks from the user's input directory."""
import asyncio
from datetime import date,time
from itertools import islice
from pathlib import Path
import os
from typing import Any

from openpyxl import load_workbook


def desktop():
    if os.name=='nt':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
            path,_=winreg.QueryValueEx(key,'Desktop')
        return Path(os.path.expandvars(path))
    return Path.home()/'Desktop'


def read_page(root,file,sheet,start,count):
    if Path(file).name!=file or Path(file).suffix.lower()!='.xlsx' or file.startswith('~$'):
        raise ValueError('Укажите имя книги .xlsx из папки входящих файлов.')
    path=(root/file).resolve(strict=True)
    if path.parent!=root or not path.is_file():
        raise ValueError('Книга должна находиться в папке входящих файлов.')
    if start<1 or not 1<=count<=100:raise ValueError('start >= 1, count от 1 до 100.')
    book=load_workbook(path,read_only=True,data_only=True,keep_links=False)
    try:
        ws=book[sheet] if sheet else book.worksheets[0]
        rows=[]
        def cell(v):
            if isinstance(v,(date,time)):return v.isoformat()
            return v
        for i,row in enumerate(islice(ws.iter_rows(min_row=start,values_only=True),count+1),start):
            values=list(map(cell,row))
            while values and values[-1] is None:values.pop()
            rows.append({'row':i,'values':values})
        return {'file':file,'sheets':book.sheetnames,'sheet':ws.title,'rows':rows[:count],
                'next':start+count if len(rows)>count else None}
    finally:book.close()


def register_workbooks(server,directory):
    root=Path(directory or desktop()).resolve()

    @server.tool(structured_output=True)
    async def list_workbooks(query:str='')->dict[str,Any]:
        """List Excel .xlsx filenames in the operator's inbox (normally Desktop), optionally matching text."""
        def names():
            return sorted(f.name for f in root.iterdir() if f.suffix.lower()=='.xlsx' and not f.name.startswith('~$')
                          and query.casefold() in f.name.casefold() and f.resolve().parent==root and f.is_file())
        return {'files':await asyncio.to_thread(names)}

    @server.tool(structured_output=True)
    async def read_workbook(file:str,sheet:str='',start:int=1,count:int=25)->dict[str,Any]:
        """Read a page of cached Excel cell values, with sheet names, 1-based row numbers and next offset."""
        return await asyncio.to_thread(read_page,root,file,sheet,start,count)
