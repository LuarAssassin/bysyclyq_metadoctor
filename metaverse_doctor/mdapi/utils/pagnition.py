from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

# 标准分页类
class StandardResultsSetPagination(PageNumberPagination):
    """标准分页类"""
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100

    def get_paginated_response(self, data):
        """自定义分页响应格式"""
        return Response({
            "code": 200,
            "message": "获取成功",
            "data": {
                "count": self.page.paginator.count,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
                "total_pages": self.page.paginator.num_pages,
                "current_page": self.page.number
            }
        }) 